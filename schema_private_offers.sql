-- Private offer pages (one secret link per customer). Run once:
--   wrangler d1 execute iwisglobal-bookings --remote --file=schema_private_offers.sql
CREATE TABLE IF NOT EXISTS private_offers (
  id TEXT PRIMARY KEY,                       -- 'po_' + 32 hex: the secret in the link
  status TEXT NOT NULL DEFAULT 'open',       -- open | closed
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL,                    -- EUR | USD | INR
  content_json TEXT NOT NULL,                -- title, summary, date, travellers, pickup, hotel, itinerary[], includes[], excludes[], cancellation
  options_json TEXT NOT NULL,                -- [{id,label,vehicle,totalMinor}]
  deposit_percent INTEGER NOT NULL DEFAULT 40,
  german_guide_extra_minor INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS offer_payments (
  id TEXT PRIMARY KEY,                       -- 'op_' + uuid
  offer_id TEXT NOT NULL,
  option_id TEXT NOT NULL,
  guide_language TEXT NOT NULL,              -- en | de
  kind TEXT NOT NULL,                        -- full | deposit | balance
  amount_minor INTEGER NOT NULL,
  total_minor INTEGER NOT NULL,              -- trip total at the time of the order
  currency TEXT NOT NULL,
  order_id TEXT NOT NULL DEFAULT '',
  payment_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,                      -- created | paid
  payer_name TEXT NOT NULL DEFAULT '',
  payer_email TEXT NOT NULL DEFAULT '',
  payer_phone TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_offer_payments_offer ON offer_payments (offer_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_offer_payments_payment ON offer_payments (payment_id) WHERE payment_id != '';
