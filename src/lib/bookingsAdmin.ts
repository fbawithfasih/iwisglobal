import type { BookingRow } from './crm';
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
