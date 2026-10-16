-- Agra hotel booking (Hotelbeds). Run once:
--   wrangler d1 execute iwisglobal-bookings --remote --file=schema_hotels.sql
CREATE TABLE IF NOT EXISTS hotel_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO hotel_settings (key, value) VALUES
  ('enabled', '0'), ('markup_percent', '0'), ('fx_eur_inr', '0'), ('fx_eur_usd', '0'),
  ('contract_currency', 'EUR'), ('destination_code', 'AGR'), ('min_stars', '0'), ('excluded_codes', '');

CREATE TABLE IF NOT EXISTS hotel_content (
  code INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category_code TEXT NOT NULL DEFAULT '',
  category_name TEXT NOT NULL DEFAULT '',
  stars INTEGER NOT NULL DEFAULT 0,
  address TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  lat REAL, lon REAL,
  description TEXT NOT NULL DEFAULT '',
  images_json TEXT NOT NULL DEFAULT '[]',
  facilities_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hotel_sync (id INTEGER PRIMARY KEY CHECK (id = 1), last_run TEXT, last_count INTEGER, last_error TEXT);
INSERT OR IGNORE INTO hotel_sync (id) VALUES (1);

CREATE TABLE IF NOT EXISTS hotel_bookings (
  id TEXT PRIMARY KEY,                       -- hb_<uuid>; also the Hotelbeds clientReference
  status TEXT NOT NULL,                      -- quoted | paid | booked | failed | cancelled
  currency TEXT NOT NULL,                    -- INR | USD (what the guest pays)
  hotel_code INTEGER NOT NULL,
  search_json TEXT NOT NULL,
  selected_json TEXT NOT NULL,               -- chosen rate, price and cancellation as of CheckRate
  net_cost REAL NOT NULL,                    -- Hotelbeds net, contract currency
  sell_total INTEGER NOT NULL,               -- guest price, whole currency units
  order_id TEXT NOT NULL DEFAULT '',
  payment_id TEXT NOT NULL DEFAULT '',
  hb_reference TEXT NOT NULL DEFAULT '',
  holder_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  guests_json TEXT NOT NULL DEFAULT '[]',
  supplier_json TEXT NOT NULL DEFAULT '{}',  -- supplier name and VAT from the booking response
  locale TEXT NOT NULL DEFAULT 'en',
  custom_trip_id TEXT NOT NULL DEFAULT '',
  refunded INTEGER NOT NULL DEFAULT 0,       -- whole currency units refunded
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hotel_bookings_order ON hotel_bookings (order_id);
CREATE INDEX IF NOT EXISTS idx_hotel_bookings_status ON hotel_bookings (status, created_at);

-- Shown rates kept for 30 minutes so the server, not the browser, supplies
-- net price and cancellation terms when a guest picks one.
CREATE TABLE IF NOT EXISTS hotel_rate_cache (
  rate_key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
