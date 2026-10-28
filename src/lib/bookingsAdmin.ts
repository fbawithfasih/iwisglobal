import type { D1Like } from './db';
import { listBookings, type BookingRow } from './crm';
import { listTourTicketInfo, type TourTicketInfo } from './tours';
import { AWAITING_STATUS } from './customTripPayment';

// Views, search and "why this needs you" reasons for the admin Bookings list (src/pages/admin/index.astro).
// Pure functions over the rows listBookings returns, so they are easy to test.

export const BOOKING_VIEWS = [
  { key: 'attention', label: 'Needs attention' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'awaiting', label: 'Waiting for you' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'all', label: 'All' },
] as const;
export type BookingViewKey = (typeof BOOKING_VIEWS)[number]['key'];

export const TICKET_WINDOW_DAYS = 7;
export const BALANCE_WINDOW_DAYS = 14;

export type Reason = { key: 'awaiting' | 'tickets' | 'balance'; label: string };

const DAY = 86_400_000;
const daysUntil = (travelDate: string, today: string) => Math.round((Date.parse(travelDate) - Date.parse(today)) / DAY);

/** What a booking is waiting on from the team. Empty when nothing is. */
export function bookingReasons(b: BookingRow, today: string, ticketsNeeded: boolean): Reason[] {
  const out: Reason[] = [];
  if (b.status === AWAITING_STATUS) out.push({ key: 'awaiting', label: 'Waiting for you' });
  if (b.status !== 'confirmed') return out;
  const d = daysUntil(b.travel_date, today);
  if (ticketsNeeded && d <= TICKET_WINDOW_DAYS) out.push({ key: 'tickets', label: d < 0 ? 'Tickets needed (trip date passed)' : 'Tickets needed' });
  if (b.total_amount > b.amount_paid && d <= BALANCE_WINDOW_DAYS) out.push({ key: 'balance', label: 'Balance due' });
  return out;
}

export function searchBookings(rows: BookingRow[], q: string, tourName: (id: string) => string): BookingRow[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return rows;
  const digits = needle.replace(/\D/g, '');
  return rows.filter((b) =>
    [b.traveler_name, b.traveler_email, b.id, tourName(b.tour_id)].some((v) => v.toLowerCase().includes(needle)) ||
    (digits.length >= 4 && b.traveler_phone.replace(/\D/g, '').includes(digits)));
}

export function viewBookings(rows: BookingRow[], view: BookingViewKey, today: string, ticketsNeeded: (b: BookingRow) => boolean): BookingRow[] {
  const byDateAsc = (a: BookingRow, b: BookingRow) => a.travel_date.localeCompare(b.travel_date) || a.created_at.localeCompare(b.created_at);
  switch (view) {
    case 'attention':
      return rows.filter((b) => bookingReasons(b, today, ticketsNeeded(b)).length > 0).sort(byDateAsc); // soonest trip first
    case 'upcoming':
      return rows.filter((b) => (b.status === 'confirmed' || b.status === AWAITING_STATUS) && b.travel_date >= today).sort(byDateAsc);
    case 'awaiting':
      return rows.filter((b) => b.status === AWAITING_STATUS);
    case 'confirmed':
    case 'completed':
    case 'cancelled':
      return rows.filter((b) => b.status === view);
    default:
      return rows;
  }
}

export function bookingCounts(rows: BookingRow[], today: string, ticketsNeeded: (b: BookingRow) => boolean): Record<BookingViewKey, number> {
  const out = {} as Record<BookingViewKey, number>;
  for (const v of BOOKING_VIEWS) out[v.key] = viewBookings(rows, v.key, today, ticketsNeeded).length;
  return out;
}

/** Everything the Bookings list needs from the database, sent together so the page waits for one round trip, not three. */
export async function loadBookingsAndTours(db: D1Like): Promise<{ bookings: BookingRow[]; tours: TourTicketInfo[] }> {
  const [bookings, tours] = await Promise.all([listBookings(db, {}), listTourTicketInfo(db)]);
  return { bookings, tours };
}

export interface OutlookDay { day: string; count: number; pax: number; toPrepare: number }

/** The next `days` days (today first): how many live trips start each day, how many guests, and how many of those still need something. */
export function outlook(rows: BookingRow[], today: string, ticketsNeeded: (b: BookingRow) => boolean, days = 14): OutlookDay[] {
  const out: OutlookDay[] = Array.from({ length: days }, (_, i) => ({ day: new Date(Date.parse(`${today}T00:00:00Z`) + i * DAY).toISOString().slice(0, 10), count: 0, pax: 0, toPrepare: 0 }));
  const byDay = new Map(out.map((d) => [d.day, d]));
  for (const b of rows) {
    if (b.status !== 'confirmed' && b.status !== AWAITING_STATUS) continue;
    const d = byDay.get(b.travel_date);
    if (!d) continue;
    d.count += 1;
    d.pax += b.travelers;
    if (bookingReasons(b, today, ticketsNeeded(b)).length > 0 || !b.pickup_time || !b.guide_assigned || !b.driver_name) d.toPrepare += 1;
  }
  return out;
}

export interface StatusMix { confirmed: number; completed: number; awaiting: number; cancelled: number; total: number }

export function statusMix(rows: BookingRow[]): StatusMix {
  const m: StatusMix = { confirmed: 0, completed: 0, awaiting: 0, cancelled: 0, total: 0 };
  for (const b of rows) {
    const k = b.status === AWAITING_STATUS ? 'awaiting' : b.status === 'confirmed' || b.status === 'completed' || b.status === 'cancelled' ? b.status : null;
    if (k) m[k] += 1;
    m.total += 1;
  }
  return m;
}

/** "Today", "Tomorrow", "In 5 days", "3 days ago", with how near it is so the page can colour it. */
export function whenLabel(travelDate: string, today: string): { text: string; tone: 'now' | 'soon' | 'later' | 'past' } {
  const d = daysUntil(travelDate, today);
  if (d === 0) return { text: 'Today', tone: 'now' };
  if (d === 1) return { text: 'Tomorrow', tone: 'now' };
  if (d > 1) return { text: `In ${d} days`, tone: d <= 7 ? 'soon' : 'later' };
  return { text: d === -1 ? 'Yesterday' : `${-d} days ago`, tone: 'past' };
}

/** Bookings whose trip is on one day; anything that is not a real date leaves the list alone. */
export function onDate(rows: BookingRow[], ymd: string): BookingRow[] {
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? rows.filter((b) => b.travel_date === ymd) : rows;
}
