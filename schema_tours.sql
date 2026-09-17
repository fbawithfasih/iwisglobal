-- Moves the tour catalog from build-time Markdown content collections into
-- D1, so tours can be created/edited from the admin CRM without a redeploy.

CREATE TABLE IF NOT EXISTS tours (
  id TEXT PRIMARY KEY,               -- catalog key used by payment routes, e.g. SAME_DAY_AGRA_DELHI
  slug TEXT NOT NULL UNIQUE,         -- URL slug, e.g. same-day-agra-from-delhi
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  duration_label TEXT NOT NULL,
  start_point TEXT NOT NULL,
  amount INTEGER NOT NULL,           -- price per traveler, major currency units
  currency TEXT NOT NULL DEFAULT 'INR',
  highlights TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
  itinerary TEXT NOT NULL DEFAULT '[]',    -- JSON array of {time, activity}
  includes TEXT NOT NULL DEFAULT '[]',     -- JSON array of strings
  excludes TEXT NOT NULL DEFAULT '[]',     -- JSON array of strings
  image TEXT NOT NULL DEFAULT '',
  featured INTEGER NOT NULL DEFAULT 0,     -- 0/1
  status TEXT NOT NULL DEFAULT 'published', -- 'published' | 'draft'
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tour_addons (
  id TEXT PRIMARY KEY,
  tour_id TEXT NOT NULL,
  name TEXT NOT NULL,
  amount INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tour_addons_tour ON tour_addons (tour_id);

-- Migrate the existing Markdown-authored tour so nothing breaks.
INSERT OR IGNORE INTO tours
  (id, slug, title, summary, description, duration_label, start_point, amount, currency,
   highlights, itinerary, includes, excludes, image, featured, status, created_at, updated_at)
VALUES (
  'SAME_DAY_AGRA_DELHI',
  'same-day-agra-from-delhi',
  'Same-Day Taj Mahal Tour from Delhi',
  'A comfortable, private same-day trip from Delhi to Agra — see the Taj Mahal, Agra Fort, and a curated art gallery stop, then return to Delhi by night.',
  'Skip the chaos of booking through informal touts at the airport. IWIS Global runs a single, professionally guided same-day trip from Delhi to Agra, built for travelers who want to see the Taj Mahal comfortably and get back to Delhi the same night.',
  'Same-day (12–14 hrs)',
  'Delhi Airport or New Delhi hotels',
  4999,
  'INR',
  '["Private air-conditioned vehicle, door-to-door from your Delhi hotel or the airport","Skip-the-line entry to the Taj Mahal with an English-speaking guide","Agra Fort visit","Optional stop at a local marble-inlay art gallery for souvenirs"]',
  '[{"time":"5:30 AM","activity":"Pickup from Delhi hotel / airport"},{"time":"8:30 AM","activity":"Arrive Agra, breakfast"},{"time":"9:30 AM","activity":"Taj Mahal guided tour"},{"time":"12:00 PM","activity":"Agra Fort"},{"time":"1:30 PM","activity":"Lunch"},{"time":"2:30 PM","activity":"Optional art gallery / souvenir stop"},{"time":"4:00 PM","activity":"Depart for Delhi"},{"time":"7:30 PM","activity":"Drop-off in Delhi"}]',
  '["Private transport (Delhi ↔ Agra)","English-speaking guide","Taj Mahal & Agra Fort entry tickets"]',
  '["Meals (available to add on)","Personal expenses"]',
  '',
  1,
  'published',
  '2026-09-17T00:00:00.000Z',
  '2026-09-17T00:00:00.000Z'
);

INSERT OR IGNORE INTO tour_addons (id, tour_id, name, amount, created_at)
VALUES ('ART_GALLERY_STOP', 'SAME_DAY_AGRA_DELHI', 'Art gallery & souvenir stop', 500, '2026-09-17T00:00:00.000Z');
