// Cloudflare D1 access for bookings. `DB` is the binding configured in
// wrangler.toml ([[d1_databases]] binding = "DB").
//
// Schema (run once via `wrangler d1 execute iwisglobal-bookings --file=schema.sql`):
//
//   CREATE TABLE bookings (
//     id TEXT PRIMARY KEY,
//     payment_id TEXT NOT NULL UNIQUE,
//     order_id TEXT NOT NULL,
//     tour_id TEXT NOT NULL,
//     travel_date TEXT NOT NULL,       -- ISO date, e.g. "2026-10-05"
//     travelers INTEGER NOT NULL,
//     add_on_ids TEXT NOT NULL DEFAULT '', -- comma-separated
//     traveler_name TEXT NOT NULL,
//     traveler_email TEXT NOT NULL,
//     traveler_phone TEXT NOT NULL,
//     amount_paid INTEGER NOT NULL,    -- smallest currency subunit
//     currency TEXT NOT NULL,
//     created_at TEXT NOT NULL
//   );

export interface D1Like {
  prepare(query: string): {
    bind(...values: unknown[]): {
      run(): Promise<{ meta?: { changes?: number } }>;
      first<T = unknown>(): Promise<T | null>;
      all<T = unknown>(): Promise<{ results: T[] }>;
    };
  };
}

// Same-day Agra tour: one vehicle/guide slot per date. Keep this simple cap
// rather than a full availability calendar for Phase 1. Shared by the
// fast-fail check in create-order.ts and the authoritative check in
// insertVerifiedBooking below.
export const MAX_TRAVELERS_PER_DATE = 12;

export interface BookingRecord {
  id: string;
  paymentId: string;
  orderId: string;
  tourId: string;
  travelDate: string;
  travelers: number;
  addOnIds: string[];
  travelerName: string;
  travelerEmail: string;
  travelerPhone: string;
  amountPaid: number;
  currency: string;
  // Set only when the buyer was signed in (Google/Apple SSO — see
  // customerAuth.ts) at the time of booking, so it shows up on their "My
  // Bookings" page. Guest checkout leaves this null, same as today.
  customerId?: string | null;
}

export type InsertBookingOutcome = 'inserted' | 'duplicate' | 'capacity_exceeded';

// Inserts a payment-verified booking with the capacity check baked into the
// INSERT itself (a single D1 round trip), rather than a separate
// check-then-insert — two concurrent verify-payment calls for the same
// tour+date can no longer both read "10 booked" and both squeeze past the
// cap, because the capacity subquery and the write happen atomically.
//
// Idempotent: verify-payment can be called more than once for the same
// payment (client retry, double submit); the UNIQUE(payment_id) constraint
// makes a second insert for the same payment fail, which is caught and
// reported as 'duplicate' rather than 'capacity_exceeded'.
export async function insertVerifiedBooking(
  db: D1Like,
  booking: BookingRecord,
  maxTravelersPerDate: number
): Promise<InsertBookingOutcome> {
  const existing = await db.prepare(`SELECT 1 FROM bookings WHERE payment_id = ?`).bind(booking.paymentId).first();
  if (existing) return 'duplicate';

  try {
    const result = await db
      .prepare(
        `INSERT INTO bookings
          (id, payment_id, order_id, tour_id, travel_date, travelers, add_on_ids,
           traveler_name, traveler_email, traveler_phone, amount_paid, currency, created_at, customer_id)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE (SELECT COALESCE(SUM(travelers), 0) FROM bookings WHERE tour_id = ? AND travel_date = ?) + ? <= ?`
      )
      .bind(
        booking.id,
        booking.paymentId,
        booking.orderId,
        booking.tourId,
        booking.travelDate,
        booking.travelers,
        booking.addOnIds.join(','),
        booking.travelerName,
        booking.travelerEmail,
        booking.travelerPhone,
        booking.amountPaid,
        booking.currency,
        new Date().toISOString(),
        booking.customerId ?? null,
        booking.tourId,
        booking.travelDate,
        booking.travelers,
        maxTravelersPerDate
      )
      .run();
    return (result?.meta?.changes ?? 0) > 0 ? 'inserted' : 'capacity_exceeded';
  } catch {
    // Two requests for the same payment raced past the SELECT above; the
    // later one hits the UNIQUE(payment_id)/PRIMARY KEY(id) constraint.
    const stillMissing = !(await db.prepare(`SELECT 1 FROM bookings WHERE payment_id = ?`).bind(booking.paymentId).first());
    if (stillMissing) throw new Error('Could not save booking');
    return 'duplicate';
  }
}

// Phase 1's capacity check: how many travelers are already booked on a given
// tour + date. Keeps overbooking out of the same-day Agra tour (one
// vehicle/guide per date) without needing a full availability calendar yet.
export async function travelersBookedOn(db: D1Like, tourId: string, travelDate: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COALESCE(SUM(travelers), 0) as total FROM bookings WHERE tour_id = ? AND travel_date = ?`)
    .bind(tourId, travelDate)
    .first<{ total: number }>();
  return row?.total ?? 0;
}
