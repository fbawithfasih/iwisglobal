-- Backlog 0.4: 25% deposit option, balance on pickup. Online-payment flow
-- only (create-order.ts / verify-payment.ts) — manual/phone bookings
-- (admin/bookings/new.astro) keep defaulting to 'full', same as today.
--
-- amount_paid (existing column) stays "what was actually charged via
-- Razorpay right now" — a deposit or the full amount. total_amount is the
-- full tour price regardless of what's been paid, so balance due is always
-- total_amount - amount_paid, computed wherever it's displayed rather than
-- stored redundantly.
ALTER TABLE bookings ADD COLUMN total_amount INTEGER;
ALTER TABLE bookings ADD COLUMN payment_type TEXT NOT NULL DEFAULT 'full';

-- Backfill: every booking before this migration was paid in full, so its
-- total is exactly what was already paid.
UPDATE bookings SET total_amount = amount_paid WHERE total_amount IS NULL;
