-- Backlog 0.2 + 0.3 (docs/execution-backlog.md, provided by the user).
--
-- 0.2: per-group pricing tiers, so price-per-traveler varies with group
-- size instead of a flat multiply. A tour with no rows here keeps using its
-- flat `tours.amount`/`usd_amount` — this table is additive, not required.
--
-- 0.3: tour_addons gains `included_by_default` so an add-on (e.g. monument
-- entry) can be bundled into the price by default, with the customer able
-- to opt out (unchecking it in the booking widget subtracts its price) —
-- reusing the existing add-on total mechanism rather than a new discount
-- path. No add-on row is seeded here: the at-cost entry-ticket price is an
-- operational fact that must come from the operator, not be guessed (see
-- CLAUDE.md hard rule 1). Add it via /admin/tours once you have the figure.

CREATE TABLE IF NOT EXISTS tour_pricing_tiers (
  id TEXT PRIMARY KEY,
  tour_id TEXT NOT NULL,
  travelers INTEGER NOT NULL,        -- group size this tier applies to
  amount INTEGER NOT NULL,           -- price PER TRAVELER at this group size, major currency units
  usd_amount INTEGER,                -- optional, same "admin sets explicitly, never auto-converted" rule as tours.usd_amount
  created_at TEXT NOT NULL,
  UNIQUE (tour_id, travelers)
);

CREATE INDEX IF NOT EXISTS idx_pricing_tiers_tour ON tour_pricing_tiers (tour_id);

ALTER TABLE tour_addons ADD COLUMN included_by_default INTEGER NOT NULL DEFAULT 0;

-- Seed the two tours' INR tiers with the exact numbers from
-- docs/execution-backlog.md 0.2 (Option A). No USD tiers seeded — none were
-- given; USD keeps using the flat tours.usd_amount fallback until the admin
-- sets USD tiers explicitly.
INSERT OR IGNORE INTO tour_pricing_tiers (id, tour_id, travelers, amount, created_at) VALUES
  ('TIER_SAMEDAY_1', 'SAME_DAY_AGRA_DELHI', 1, 11999, datetime('now')),
  ('TIER_SAMEDAY_2', 'SAME_DAY_AGRA_DELHI', 2, 6499,  datetime('now')),
  ('TIER_SAMEDAY_3', 'SAME_DAY_AGRA_DELHI', 3, 5499,  datetime('now')),
  ('TIER_SAMEDAY_4', 'SAME_DAY_AGRA_DELHI', 4, 4499,  datetime('now')),
  ('TIER_SUNRISE_1', 'TAJ_MAHAL_SUNRISE_TOUR', 1, 14999, datetime('now')),
  ('TIER_SUNRISE_2', 'TAJ_MAHAL_SUNRISE_TOUR', 2, 7999,  datetime('now')),
  ('TIER_SUNRISE_3', 'TAJ_MAHAL_SUNRISE_TOUR', 3, 6499,  datetime('now')),
  ('TIER_SUNRISE_4', 'TAJ_MAHAL_SUNRISE_TOUR', 4, 5499,  datetime('now'));
