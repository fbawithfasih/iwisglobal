-- "Customise your Agra tour" (phase 1). Additive only: apply to D1 before
-- deploying the code that reads these tables. Safe to run twice.
--
-- The owner enters real prices in /admin/custom-trips. Until then every
-- vehicle is inactive and every rate is 0, and the 'enabled' setting is off, so
-- nothing is visible to guests.

-- Vehicle types a guest can choose. Rates are whole rupees (and dollars; NULL
-- means "convert the rupee rate at the usd_rate setting").
CREATE TABLE IF NOT EXISTS custom_vehicles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  seats INTEGER NOT NULL,
  agra_day_inr INTEGER NOT NULL DEFAULT 0,      -- one sightseeing day in Agra
  agra_day_usd INTEGER,
  delhi_return_inr INTEGER NOT NULL DEFAULT 0,  -- Delhi/Gurgaon/Noida/airport round trip
  delhi_return_usd INTEGER,
  active INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO custom_vehicles (id, name, seats, active, sort) VALUES
  ('sedan',  'Sedan',                        3,  0, 1),
  ('suv',    'SUV or MUV',                   6,  0, 2),
  ('tempo',  'Tempo Traveller',              12, 0, 3),
  ('luxury', 'Luxury car (Mercedes or BMW)', 3,  0, 4);

-- Single-value settings. 'enabled' gates the whole feature.
CREATE TABLE IF NOT EXISTS custom_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO custom_settings (key, value) VALUES
  ('enabled', '0'),
  ('guide_day_inr', '0'),
  ('guide_day_usd', ''),
  ('max_days', '7'),
  ('day_minutes', '600'),   -- the most a day's stops plus travel may take
  ('usd_rate', '96');       -- rupees per dollar, for ticket fees and unset dollar rates

-- Stops a guest can pick for a day.
CREATE TABLE IF NOT EXISTS custom_stops (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  attraction_slug TEXT NOT NULL DEFAULT '',   -- /agra/<slug> page, if any
  visit_minutes INTEGER NOT NULL DEFAULT 60,
  travel_minutes INTEGER NOT NULL DEFAULT 20,  -- typical drive to reach it from the previous stop
  closed_fridays INTEGER NOT NULL DEFAULT 0,
  night_only INTEGER NOT NULL DEFAULT 0,       -- only on the ASI night-viewing nights
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);

-- Visit and drive times are estimates; the owner can edit them.
INSERT OR IGNORE INTO custom_stops (id, name, attraction_slug, visit_minutes, travel_minutes, closed_fridays, night_only, active, sort) VALUES
  ('taj-mahal',        'Taj Mahal',                'taj-mahal',        150, 20, 1, 0, 1, 1),
  ('agra-fort',        'Agra Fort',                'agra-fort',        120, 20, 0, 0, 1, 2),
  ('itimad-ud-daulah', 'Itimad-ud-Daulah (Baby Taj)', 'itimad-ud-daulah', 45, 20, 0, 0, 1, 3),
  ('mehtab-bagh',      'Mehtab Bagh',              'mehtab-bagh',      60,  25, 0, 0, 1, 4),
  ('fatehpur-sikri',   'Fatehpur Sikri',           'fatehpur-sikri',   150, 60, 0, 0, 1, 5);

-- Official ASI entry fees per adult, whole rupees. friday_inr and after_taj_inr
-- are the lower fees ASI charges on Fridays or after the Taj Mahal that day
-- (NULL = no special fee). Children under 15 are free. Seeded from the
-- attraction pages; the owner keeps them current (checked_on shows when).
CREATE TABLE IF NOT EXISTS custom_stop_fees (
  stop_id TEXT NOT NULL,
  category TEXT NOT NULL,        -- 'foreign' | 'indian' | 'saarc'
  fee_inr INTEGER NOT NULL DEFAULT 0,
  friday_inr INTEGER,
  after_taj_inr INTEGER,
  checked_on TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (stop_id, category)
);

INSERT OR IGNORE INTO custom_stop_fees (stop_id, category, fee_inr, friday_inr, after_taj_inr, checked_on) VALUES
  ('taj-mahal',        'foreign', 1300, NULL, NULL, '2026-09-30'),
  ('taj-mahal',        'indian',  250,  NULL, NULL, '2026-09-30'),
  ('taj-mahal',        'saarc',   740,  NULL, NULL, '2026-09-30'),
  ('agra-fort',        'foreign', 650,  600,  600,  '2026-09-30'),
  ('agra-fort',        'indian',  50,   40,   NULL, '2026-09-30'),
  ('agra-fort',        'saarc',   90,   40,   40,   '2026-09-30'),
  ('itimad-ud-daulah', 'foreign', 310,  300,  300,  '2026-09-30'),
  ('itimad-ud-daulah', 'indian',  30,   25,   NULL, '2026-09-30'),
  ('itimad-ud-daulah', 'saarc',   30,   25,   25,   '2026-09-30'),
  ('mehtab-bagh',      'foreign', 300,  NULL, NULL, '2026-09-30'),
  ('mehtab-bagh',      'indian',  25,   NULL, NULL, '2026-09-30'),
  ('mehtab-bagh',      'saarc',   25,   NULL, NULL, '2026-09-30'),
  ('fatehpur-sikri',   'foreign', 610,  600,  600,  '2026-09-30'),
  ('fatehpur-sikri',   'indian',  50,   40,   NULL, '2026-09-30'),
  ('fatehpur-sikri',   'saarc',   50,   40,   40,   '2026-09-30');

-- A guest's priced trip. trip_json holds their selections and price_json the
-- exact breakdown the server charged against, so verification can check the
-- payment against what was quoted. Used from milestone 3.
CREATE TABLE IF NOT EXISTS custom_trips (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'quoted',   -- quoted | deposit_paid | confirmed | cancelled
  currency TEXT NOT NULL DEFAULT 'INR',
  trip_json TEXT NOT NULL DEFAULT '{}',
  price_json TEXT NOT NULL DEFAULT '{}',
  total INTEGER NOT NULL DEFAULT 0,        -- whole rupees or dollars
  deposit INTEGER NOT NULL DEFAULT 0,
  order_id TEXT NOT NULL DEFAULT '',
  booking_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_custom_trips_order ON custom_trips (order_id);
CREATE INDEX IF NOT EXISTS idx_custom_trips_status ON custom_trips (status, created_at);
