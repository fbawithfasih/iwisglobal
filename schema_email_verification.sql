-- Confirmed account emails (src/lib/emailVerification.ts). A booking made
-- without signing in is linked to an account only once that account has
-- proven it owns the booking's email: Google/Apple say so at sign-in, an
-- email/password account by opening a "Confirm your email" link (or by
-- completing a password reset, which also proves the inbox). Without that
-- check, anyone could sign up with a guest's email and see their bookings.

ALTER TABLE customers ADD COLUMN email_verified_at TEXT;

-- One-time confirmation links, stored as SHA-256 hashes only (same scheme as
-- password_resets). Each lasts 24 hours; created_at also limits resends.
CREATE TABLE IF NOT EXISTS email_verifications (
  token_hash TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_email_verifications_customer ON email_verifications (customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bookings_traveler_email ON bookings (lower(traveler_email));
