-- Pay-the-balance links for tour bookings that paid a deposit (src/lib/balancePayment.ts).
-- Apply once: wrangler d1 execute <db> --remote --file=schema_balance_links.sql
-- id is the secret token in the guest's link (/pay/<id>). The amount is fixed
-- when the link is made; the order is only opened if the booking still owes
-- exactly that amount. status: created | paid | void.
CREATE TABLE IF NOT EXISTS booking_balance_links (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  order_id TEXT NOT NULL DEFAULT '',
  payment_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'created',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_balance_links_payment ON booking_balance_links (payment_id) WHERE payment_id != '';
CREATE INDEX IF NOT EXISTS idx_balance_links_booking ON booking_balance_links (booking_id, status);
