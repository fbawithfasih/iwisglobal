-- Offers and coupon codes (admin: /admin/offers; logic: src/lib/offers.ts).
-- An offer with no code applies automatically; one with a code needs the
-- customer to enter it. Only one discount applies per booking — the biggest
-- of the Founding Guest Offer, any automatic offer and the entered coupon.
CREATE TABLE IF NOT EXISTS offers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,                    -- shown to customers, e.g. "Diwali Offer"
  code TEXT UNIQUE,                      -- NULL = automatic; stored uppercase
  kind TEXT NOT NULL CHECK (kind IN ('percent', 'fixed')),
  percent INTEGER,                       -- kind = 'percent': 1–90
  amount_inr INTEGER,                    -- kind = 'fixed': rupees off
  amount_usd INTEGER,                    -- kind = 'fixed': dollars off; NULL = not for USD payments
  tour_ids TEXT NOT NULL DEFAULT '[]',   -- JSON array of tour ids; [] = every tour
  starts_on TEXT,                        -- booking-date window, YYYY-MM-DD India time, inclusive
  ends_on TEXT,
  travel_from TEXT,                      -- travel-date window, inclusive
  travel_to TEXT,
  min_travelers INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- What each booking got, snapshotted so later edits to an offer don't
-- rewrite history. discount_amount is in the smallest unit (paise/cents).
ALTER TABLE bookings ADD COLUMN offer_id TEXT;
ALTER TABLE bookings ADD COLUMN discount_label TEXT;
ALTER TABLE bookings ADD COLUMN discount_amount INTEGER;

-- When a tour's price last changed (set by the admin tour editor), so the
-- offer form can warn about the Consumer Protection (E-Commerce) Amendment
-- Rules 2026: from 1 Jan 2027 a struck-through price must be the lowest of
-- the previous 30 days. Same-Day and Gatimaan were repriced on 26–27 Sep 2026.
ALTER TABLE tours ADD COLUMN price_changed_at TEXT;
UPDATE tours SET price_changed_at = '2026-09-27T00:00:00.000Z'
  WHERE slug IN ('same-day-agra-from-delhi', 'same-day-taj-mahal-tour-by-gatimaan-express');
