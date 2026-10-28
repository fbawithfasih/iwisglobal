import type { Offer } from './offers';
import { offerStatus } from './offers';

// The pictures on the admin Offers list (src/pages/admin/offers/index.astro): which offers are live, which end soon and which nobody has used.
// Counts and dates only, never money. "uses" is the number of bookings that carry the offer (bookings.offer_id).

export type OfferState = ReturnType<typeof offerStatus>;

export const ENDING_SOON_DAYS = 7;

const DAY_MS = 86_400_000;
const ymdMs = (ymd: string): number => Date.parse(`${ymd}T00:00:00Z`);

/** Whole days from `from` to `to` (both YYYY-MM-DD). Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((ymdMs(to) - ymdMs(from)) / DAY_MS);
}

export interface OfferTiming { label: string; urgent: boolean; days: number | null }

const inDays = (n: number): string => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);

/** One line on when the offer starts or ends. Urgent: a running offer ending within a week. */
export function offerTiming(o: Pick<Offer, 'startsOn' | 'endsOn'>, state: OfferState, today: string): OfferTiming {
  if (state === 'Off') return { label: 'Switched off', urgent: false, days: null };
  if (state === 'Scheduled') {
    const n = daysBetween(today, o.startsOn as string);
    return { label: `Starts ${inDays(n)}`, urgent: false, days: n };
  }
  if (state === 'Ended') {
    const n = daysBetween(o.endsOn as string, today);
    return { label: n === 1 ? 'Ended yesterday' : `Ended ${n} days ago`, urgent: false, days: n };
  }
  if (!o.endsOn) return { label: 'No end date', urgent: false, days: null };
  const n = daysBetween(today, o.endsOn);
  return { label: n === 0 ? 'Last day today' : `Ends ${inDays(n)}`, urgent: n <= ENDING_SOON_DAYS, days: n };
}

export interface OfferSummary {
  total: number;
  running: number;
  scheduled: number;
  ended: number;
  off: number;
  /** Running and ending within a week. */
  endingSoon: number;
  /** Running with no booking yet. */
  idle: number;
  coupons: number;
  automatic: number;
  uses: number;
}

export function offerSummary(rows: { offer: Pick<Offer, 'code' | 'startsOn' | 'endsOn'>; state: OfferState; uses: number }[], today: string): OfferSummary {
  const s: OfferSummary = { total: rows.length, running: 0, scheduled: 0, ended: 0, off: 0, endingSoon: 0, idle: 0, coupons: 0, automatic: 0, uses: 0 };
  for (const r of rows) {
    if (r.state === 'Running') {
      s.running += 1;
      if (r.uses === 0) s.idle += 1;
      if (offerTiming(r.offer, r.state, today).urgent) s.endingSoon += 1;
    } else if (r.state === 'Scheduled') s.scheduled += 1;
    else if (r.state === 'Ended') s.ended += 1;
    else s.off += 1;
    if (r.offer.code) s.coupons += 1;
    else s.automatic += 1;
    s.uses += r.uses;
  }
  return s;
}

/** Bar width in percent: 0 for no uses, never below 4 so one use is visible, 100 for the busiest offer. */
export function usesBar(uses: number, max: number): number {
  if (uses <= 0 || max <= 0) return 0;
  return Math.max(4, Math.min(100, Math.round((uses / max) * 100)));
}
