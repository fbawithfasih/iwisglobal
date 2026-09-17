// India-specific "book today / book tomorrow" signal. Same-day pickup for
// the Agra tours needs early-morning coordination, so same-day booking is
// only offered until 9 PM IST the night before. Computed in India Standard
// Time (Asia/Kolkata) specifically — NOT the visitor's browser-local time,
// since a traveler in the US/UK has a different clock than the pickup
// location. Server-only: called once per page render, never on the client.

const CUTOFF_HOUR_IST = 21; // 9 PM

export interface AvailabilityInfo {
  minBookableDate: string; // YYYY-MM-DD
  sameDayAvailable: boolean;
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

export function getAvailability(now: Date = new Date()): AvailabilityInfo {
  const { year, month, day, hour } = istDateParts(now);
  const sameDayAvailable = hour < CUTOFF_HOUR_IST;

  if (sameDayAvailable) {
    return { minBookableDate: toDateString(year, month, day), sameDayAvailable: true, label: 'Book today' };
  }

  // Advance one IST calendar day using UTC arithmetic on the IST date parts
  // (avoids DST edge cases — India has no DST, so this is exact).
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    minBookableDate: toDateString(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()),
    sameDayAvailable: false,
    label: 'Book tomorrow',
  };
}
