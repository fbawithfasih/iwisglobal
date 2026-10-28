// The pictures on the admin Reviews page (src/pages/admin/reviews/index.astro): what is waiting to be checked, how guests rate the tours
// that are public, and which finished trips have not been asked for a review yet. Counts and ratings only, from what the page already loads.

export const ASK_OVERDUE_DAYS = 14;

interface RatedReview { rating: number; status: string; createdAt: string }

/** How many reviews of this status have each rating: index 0 is one star, index 4 is five stars. Out-of-range ratings are ignored. */
export function ratingCounts(reviews: Pick<RatedReview, 'rating' | 'status'>[], status = 'approved'): number[] {
  const out = [0, 0, 0, 0, 0];
  for (const r of reviews) if (r.status === status && Number.isInteger(r.rating) && r.rating >= 1 && r.rating <= 5) out[r.rating - 1] += 1;
  return out;
}

/** The average rating to one decimal, or null with no reviews. */
export function averageOf(ratings: number[]): number | null {
  const valid = ratings.filter((n) => Number.isInteger(n) && n >= 1 && n <= 5);
  return valid.length ? Math.round((valid.reduce((s, n) => s + n, 0) / valid.length) * 10) / 10 : null;
}

export interface ReviewSummary {
  total: number;
  pending: number;
  approved: number;
  hidden: number;
  /** Average of the approved reviews only: what the website shows. */
  average: number | null;
  /** Days the oldest pending review has been waiting; null when none is. */
  oldestPendingDays: number | null;
}

export function reviewSummary(reviews: RatedReview[], nowMs: number): ReviewSummary {
  const s: ReviewSummary = { total: reviews.length, pending: 0, approved: 0, hidden: 0, average: null, oldestPendingDays: null };
  for (const r of reviews) {
    if (r.status === 'pending') {
      s.pending += 1;
      const ms = Date.parse(r.createdAt);
      if (Number.isFinite(ms)) {
        const days = Math.max(0, Math.floor((nowMs - ms) / 86_400_000));
        s.oldestPendingDays = s.oldestPendingDays === null ? days : Math.max(s.oldestPendingDays, days);
      }
    } else if (r.status === 'approved') s.approved += 1;
    else if (r.status === 'hidden') s.hidden += 1;
  }
  s.average = averageOf(reviews.filter((r) => r.status === 'approved').map((r) => r.rating));
  return s;
}

/** Whole days from a trip date to today (both YYYY-MM-DD); 0 for a bad date or one in the future. */
export function daysSinceTrip(travelDate: string, today: string): number {
  const a = Date.parse(`${travelDate}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.round((b - a) / 86_400_000)) : 0;
}

/** "Trip was yesterday", "Trip was 9 days ago". */
export function tripAgeLabel(days: number): string {
  return days <= 0 ? 'Trip was today' : days === 1 ? 'Trip was yesterday' : `Trip was ${days} days ago`;
}

export interface AskMix { total: number; overdue: number; oldestDays: number | null }

/** Finished trips not yet asked. "Overdue": more than two weeks since the trip, when a guest is less likely to write. */
export function askMix(candidates: { travelDate: string }[], today: string): AskMix {
  const days = candidates.map((c) => daysSinceTrip(c.travelDate, today));
  return { total: candidates.length, overdue: days.filter((d) => d > ASK_OVERDUE_DAYS).length, oldestDays: days.length ? Math.max(...days) : null };
}

/** Bar width in percent: 0 for none, at least 4 so one is visible, 100 for the largest. */
export function barWidth(n: number, max: number): number {
  return n <= 0 || max <= 0 ? 0 : Math.max(4, Math.min(100, Math.round((n / max) * 100)));
}
