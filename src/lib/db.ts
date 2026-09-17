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
      run(): Promise<unknown>;
      first<T = unknown>(): Promise<T | null>;
      all<T = unknown>(): Promise<{ results: T[] }>;
    };
  };
}

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
}

export async function insertBooking(db: D1Like, booking: BookingRecord): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO bookings
        (id, payment_id, order_id, tour_id, travel_date, travelers, add_on_ids,
         traveler_name, traveler_email, traveler_phone, amount_paid, currency, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      new Date().toISOString()
    )
    .run();
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
