// Earliest bookable travel date. Tours start with early-morning pickups, so
// a date can be booked until 9 PM IST the night before (the rule stated in
// Help, Terms and the Shipping policy) — never for the same day. Computed in
// India Standard Time (Asia/Kolkata) specifically — NOT the visitor's
// browser-local time, since a traveler in the US/UK has a different clock
// than the pickup location. getAvailability is server-only: called once per
// page render, never on the client.

const CUTOFF_HOUR_IST = 21; // 9 PM

// Every tour visits the Taj Mahal, which is closed every Friday, so Fridays
// are never bookable. Also used by the booking widget (browser), so keep
// this free of server-only code.
export const FRIDAY_CLOSED_MESSAGE = 'The Taj Mahal is closed on Fridays — please pick another day.';
export const TAJ_DAY_CLOSED_MESSAGE = 'This tour visits the Taj Mahal on day {n}, and the Taj Mahal is closed on Fridays — please start on another day.';

// value is a YYYY-MM-DD calendar date (no time zone involved).
export function isFriday(value: string): boolean {
  return new Date(`${value}T00:00:00Z`).getUTCDay() === 5;
}

// Multi-day tours visit the Taj Mahal on a later day ("Day 2 · Taj Mahal"), and
// it is the Taj's day that must not be a Friday, not the start date. Days into
// the trip (0 = the first day) of the first itinerary stop named for the Taj
// Mahal; single-day tours have no "Day N" labels and so give 0. Free of
// server-only code: the booking widget calls it too.
export function tajDayOffset(itinerary: { time: string; activity: string }[]): number {
  // "Day 2 · …" in any language ("Día 2", "Jour 2", "Tag 2"): a word then a number.
  const dayLabel = /^\s*[A-Za-z\u00C0-\u00FF]+\.?\s*(\d+)\b/;
  for (const step of itinerary) {
    const m = step.time.match(dayLabel);
    if (m && /taj mahal/i.test(step.activity)) return Math.max(Number(m[1]) - 1, 0);
  }
  return 0;
}

// True when the tour would reach the Taj Mahal on a Friday if it started on
// `start` (a YYYY-MM-DD date). With offset 0 this is isFriday(start).
export function isTajClosedStart(start: string, offset = 0): boolean {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.getUTCDay() === 5;
}

// The first date on or after `from` that a tour with this Taj-day offset can start.
export function firstOpenStart(from: string, offset = 0): string {
  const d = new Date(`${from}T00:00:00Z`);
  while (isTajClosedStart(d.toISOString().slice(0, 10), offset)) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export interface AvailabilityInfo {
  minBookableDate: string; // YYYY-MM-DD
  label: string; // English; pages show a translated version built from isTomorrow
  isTomorrow: boolean;
}

function istDateParts(now: Date): { year: number; month: number; day: number; hour: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour === '24' ? '0' : parts.hour),
  };
}

function toDateString(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Today's date in India, YYYY-MM-DD (offer booking windows use it).
export function todayIst(now: Date = new Date()): string {
  const { year, month, day } = istDateParts(now);
  return toDateString(year, month, day);
}

export function getAvailability(now: Date = new Date()): AvailabilityInfo {
  const { year, month, day, hour } = istDateParts(now);
  // Days ahead of today (IST) of the earliest bookable date: tomorrow before
  // the 9 PM cutoff, else the day after — then one more if that lands on a
  // Friday. UTC arithmetic on the IST date parts is exact (India has no DST).
  let offset = hour < CUTOFF_HOUR_IST ? 1 : 2;
  const dateAt = (o: number) => {
    const d = new Date(Date.UTC(year, month - 1, day + o));
    return toDateString(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  };
  if (isFriday(dateAt(offset))) offset += 1;
  const minBookableDate = dateAt(offset);

  const label =
    offset === 1
      ? 'Book for tomorrow'
      : `Book for ${new Date(`${minBookableDate}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' })}`;
  return { minBookableDate, label, isTomorrow: offset === 1 };
}

// Strict "YYYY-MM-DD" check that also rejects calendar-invalid dates (e.g.
// "2026-02-30", which `new Date(...)` would otherwise silently roll over
// into March).
export function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

// Server-side re-check of the same rule the date picker's `min` attribute
// expresses client-side: a caller can't book a past date, today, or
// tomorrow after the 9 PM IST cutoff by posting directly to the booking API.
export function isBookableDate(value: string, now: Date = new Date(), tajOffset = 0): boolean {
  if (!isValidDateString(value) || isTajClosedStart(value, tajOffset)) return false;
  return value >= getAvailability(now).minBookableDate;
}
