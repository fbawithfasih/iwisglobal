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

// value is a YYYY-MM-DD calendar date (no time zone involved).
export function isFriday(value: string): boolean {
  return new Date(`${value}T00:00:00Z`).getUTCDay() === 5;
}

export interface AvailabilityInfo {
  minBookableDate: string; // YYYY-MM-DD
  label: string;
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
  return { minBookableDate, label };
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
export function isBookableDate(value: string, now: Date = new Date()): boolean {
  if (!isValidDateString(value) || isFriday(value)) return false;
  return value >= getAvailability(now).minBookableDate;
}
