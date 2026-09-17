CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL UNIQUE,
  order_id TEXT NOT NULL,
  tour_id TEXT NOT NULL,
  travel_date TEXT NOT NULL,
  travelers INTEGER NOT NULL,
  add_on_ids TEXT NOT NULL DEFAULT '',
  traveler_name TEXT NOT NULL,
  traveler_email TEXT NOT NULL,
  traveler_phone TEXT NOT NULL,
  amount_paid INTEGER NOT NULL,
  currency TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bookings_tour_date ON bookings (tour_id, travel_date);
