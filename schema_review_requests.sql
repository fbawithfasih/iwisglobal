-- Backlog 1.2: WhatsApp review request to every guest within 24h of
-- drop-off. No WhatsApp Business API integration exists in this repo (every
-- WhatsApp touchpoint here is a manual wa.me click-link, by design — see
-- BaseLayout.astro/help.astro) — this column just tracks which completed
-- bookings have already had a request sent, so /admin/reviews can show
-- "who's due" without re-prompting someone twice.
ALTER TABLE bookings ADD COLUMN review_requested_at TEXT;
