import type { CustomStop, StopFee } from './customTrip';

// The pictures on the admin "Customise your Agra tour" page (src/pages/admin/custom-trips/index.astro): how recently each stop's official
// ticket fees were checked, and how much of a day each stop takes. Pure functions over what loadRates returns.

export type FeeState = 'free' | 'fresh' | 'soon' | 'old' | 'never';

export interface FeeFreshness {
  state: FeeState;
  /** Days since the oldest fee of the stop was checked; null when the stop is free or a fee was never marked as checked. */
  days: number | null;
}

/** A fee checked within 30 days is fresh, within 90 days is due soon, older is old. A stop with no fees counts as free, as the price rules do. */
export function feeFreshness(fees: Partial<Record<string, StopFee | undefined>>, today: string): FeeFreshness {
  const set = Object.values(fees).filter((f): f is StopFee => !!f && (f.fee > 0 || (f.friday ?? 0) > 0 || (f.afterTaj ?? 0) > 0));
  if (set.length === 0) return { state: 'free', days: null };
  if (set.some((f) => !/^\d{4}-\d{2}-\d{2}$/.test(f.checkedOn))) return { state: 'never', days: null };
  const oldest = Math.max(...set.map((f) => Math.round((Date.parse(today) - Date.parse(f.checkedOn)) / 86_400_000)));
  const days = Math.max(0, oldest);
  return { state: days <= 30 ? 'fresh' : days <= 90 ? 'soon' : 'old', days };
}

export interface DayShare { minutes: number; percent: number; visitPercent: number }

/** How much of a day a stop uses: the visit plus the drive to it, against the most minutes a day may hold. */
export function dayShare(stop: Pick<CustomStop, 'visitMinutes' | 'travelMinutes'>, dayMinutes: number): DayShare {
  const minutes = Math.max(0, stop.visitMinutes) + Math.max(0, stop.travelMinutes);
  if (!(dayMinutes > 0)) return { minutes, percent: 0, visitPercent: 0 };
  return { minutes, percent: Math.round((minutes / dayMinutes) * 100), visitPercent: Math.round((Math.max(0, stop.visitMinutes) / dayMinutes) * 100) };
}

/** "2 h 30 min", "45 min", "10 h". */
export function hoursLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
}
