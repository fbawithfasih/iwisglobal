-- Backlog 2.8: server-side `purchase` event via a Razorpay webhook
-- (src/pages/api/webhooks/razorpay.ts), instead of firing it client-side on
-- a redirect-based payment flow, which undercounts when the browser
-- navigates away before the client-side call completes.
--
-- Razorpay retries webhook deliveries that don't return 2xx, and can
-- redeliver the same event even after a successful one — this table is
-- purely so a redelivered payment.captured event doesn't double-count a
-- purchase in GA4. It is NOT the booking record (bookings table already
-- owns that, written by verify-payment.ts); this only tracks "have we sent
-- the analytics event for this payment yet".
CREATE TABLE IF NOT EXISTS analytics_events_sent (
  payment_id TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL
);
