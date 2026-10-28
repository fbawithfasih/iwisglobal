import type { D1Like } from './db';
import type { ParsedTour } from './tours';
import { AWAITING_STATUS } from './customTripPayment';

// The pictures on the admin Tours list (src/pages/admin/tours/index.astro): how each tour is selling and how complete its listing is.
// Counts only. Bookings are the live ones (confirmed, completed, waiting for you), never cancelled.

export const SALES_DAYS = 90;

export interface TourStats {
  /** Live bookings made in the last 90 days. */
  bookings: number;
  /** Guests on those bookings. */
  guests: number;
  /** Approved reviews and their average, 1 to 5 (null when there are none). */
  reviews: number;
  rating: number | null;
}

export async function loadTourStats(db: D1Like, nowIso = new Date().toISOString()): Promise<Map<string, TourStats>> {
  const since = new Date(Date.parse(nowIso) - SALES_DAYS * 86_400_000).toISOString();
  const [sales, reviews] = await Promise.all([
    db.prepare(`SELECT tour_id, COUNT(*) AS n, COALESCE(SUM(travelers), 0) AS pax FROM bookings WHERE created_at >= ? AND status IN ('confirmed', 'completed', ?) GROUP BY tour_id`)
      .bind(since, AWAITING_STATUS).all<{ tour_id: string; n: number; pax: number }>(),
    db.prepare(`SELECT tour_id, COUNT(*) AS n, AVG(rating) AS avg FROM tour_reviews WHERE status = 'approved' GROUP BY tour_id`)
      .bind().all<{ tour_id: string; n: number; avg: number }>().catch(() => ({ results: [] as { tour_id: string; n: number; avg: number }[] })),
  ]);
  const out = new Map<string, TourStats>();
  const get = (id: string): TourStats => out.get(id) ?? out.set(id, { bookings: 0, guests: 0, reviews: 0, rating: null }).get(id)!;
  for (const r of sales.results) Object.assign(get(r.tour_id), { bookings: r.n, guests: r.pax });
  for (const r of reviews.results) Object.assign(get(r.tour_id), { reviews: r.n, rating: Math.round(r.avg * 10) / 10 });
  return out;
}

export interface ListingHealth { done: number; total: number; missing: string[] }

/** The six things a guest looks for on a tour page. A tour with every one is complete. */
export function listingHealth(t: Pick<ParsedTour, 'image' | 'summary' | 'description' | 'highlights' | 'itinerary' | 'amount'>): ListingHealth {
  const checks: Array<[string, boolean]> = [
    ['Photo', t.image.trim() !== ''],
    ['Short summary', t.summary.trim() !== ''],
    ['Description', t.description.trim().length >= 40],
    ['Highlights', t.highlights.length >= 3],
    ['Itinerary', t.itinerary.length >= 2],
    ['Price', t.amount > 0],
  ];
  return { done: checks.filter(([, ok]) => ok).length, total: checks.length, missing: checks.filter(([, ok]) => !ok).map(([n]) => n) };
}

/** "4.7" with one decimal, or null. */
export const ratingLabel = (rating: number | null): string | null => (rating === null ? null : rating.toFixed(1));
