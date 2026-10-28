import type { D1Like } from './db';
import type { BookingRow } from './crm';
import { AWAITING_STATUS } from './customTripPayment';
import { addDays } from './todayBoard';

// The pictures on the admin "Today" page (src/pages/admin/today.astro): the coming week of trips and how many enquiries and
// bookings arrived each day. Counts only, no money, and each part loads on its own so one failing leaves the other on screen.

export const TREND_DAYS = 28;
export const WEEK_DAYS = 7;

export interface DayCount { day: string; leads: number; bookings: number }
export interface TodayTrends {
  /** The last 28 India days, oldest first, the last one being today. */
  days: DayCount[];
  /** Confirmed trips from today to six days ahead, in date and pickup order. */
  week: BookingRow[];
  failed: Array<'week' | 'flow'>;
}

const istDayStart = (ymd: string): string => new Date(`${ymd}T00:00:00+05:30`).toISOString();

export async function loadTrends(db: D1Like, opts: { today: string }): Promise<TodayTrends> {
  const first = addDays(opts.today, -(TREND_DAYS - 1));
  const since = istDayStart(first);
  const failed: TodayTrends['failed'] = [];
  const part = async <T,>(name: TodayTrends['failed'][number], fallback: T, run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (err) {
      console.error(`today trends: ${name} failed`, err instanceof Error ? err.message : 'error');
      failed.push(name);
      return fallback;
    }
  };
  const [week, flow] = await Promise.all([
    part('week', [] as BookingRow[], async () =>
      (await db.prepare(`SELECT * FROM bookings WHERE status = 'confirmed' AND travel_date >= ? AND travel_date <= ? ORDER BY travel_date, pickup_time, created_at`)
        .bind(opts.today, addDays(opts.today, WEEK_DAYS - 1)).all<BookingRow>()).results
    ),
    part('flow', { leads: [] as { d: string; n: number }[], bookings: [] as { d: string; n: number }[] }, async () => {
      const [leads, bookings] = await Promise.all([
        db.prepare(`SELECT date(created_at, '+330 minutes') AS d, COUNT(*) AS n FROM leads WHERE created_at >= ? AND status != 'spam' GROUP BY d`).bind(since).all<{ d: string; n: number }>(),
        db.prepare(`SELECT date(created_at, '+330 minutes') AS d, COUNT(*) AS n FROM bookings WHERE created_at >= ? AND status IN ('confirmed', ?) GROUP BY d`).bind(since, AWAITING_STATUS).all<{ d: string; n: number }>(),
      ]);
      return { leads: leads.results, bookings: bookings.results };
    }),
  ]);
  const l = new Map(flow.leads.map((r) => [r.d, r.n]));
  const b = new Map(flow.bookings.map((r) => [r.d, r.n]));
  const days: DayCount[] = Array.from({ length: TREND_DAYS }, (_, i) => {
    const day = addDays(first, i);
    return { day, leads: l.get(day) ?? 0, bookings: b.get(day) ?? 0 };
  });
  return { days, week, failed };
}

export interface FlowSummary { leads: number; bookings: number; prevLeads: number; prevBookings: number }

/** Totals for the last n days and for the n days before them (the comparison). n must be at most half the window. */
export function summarise(days: DayCount[], n: number): FlowSummary {
  const cur = days.slice(-n);
  const prev = days.slice(-2 * n, -n);
  const sum = (rows: DayCount[], k: 'leads' | 'bookings') => rows.reduce((t, r) => t + r[k], 0);
  return { leads: sum(cur, 'leads'), bookings: sum(cur, 'bookings'), prevLeads: sum(prev, 'leads'), prevBookings: sum(prev, 'bookings') };
}

export interface Readiness { done: number; total: number; missing: string[] }

/** How ready a trip is: the five things the team has to have settled before the guest arrives. */
export function readiness(b: Pick<BookingRow, 'pickup_time' | 'guide_assigned' | 'driver_name' | 'total_amount' | 'amount_paid'>, ticketsOutstanding: boolean): Readiness {
  const checks: Array<[string, boolean]> = [
    ['Pickup time', !!b.pickup_time],
    ['Guide', !!b.guide_assigned],
    ['Driver', !!b.driver_name],
    ['Tickets', !ticketsOutstanding],
    ['Balance', !(b.total_amount > b.amount_paid)],
  ];
  return { done: checks.filter(([, ok]) => ok).length, total: checks.length, missing: checks.filter(([, ok]) => !ok).map(([n]) => n) };
}

/** Urgency of a wait: under an hour is calm, under four hours is worth a look, longer is late. */
export function urgency(waitingMs: number): 'calm' | 'soon' | 'late' {
  return waitingMs < 3_600_000 ? 'calm' : waitingMs < 4 * 3_600_000 ? 'soon' : 'late';
}
