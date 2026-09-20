-- Adds email/password sign-in for customer accounts, alongside the existing
-- Google/Apple SSO (schema_customers.sql). password_hash/password_salt are
-- only set for provider = 'email' rows — NULL for OAuth accounts.

ALTER TABLE customers ADD COLUMN password_hash TEXT;
ALTER TABLE customers ADD COLUMN password_salt TEXT;

-- Per-IP rate limiting for /login's email/password form, mirroring
-- admin_login_attempts (schema_login_attempts.sql) — a separate table so
-- customer and admin lockouts don't share thresholds or state.
CREATE TABLE IF NOT EXISTS customer_login_attempts (
  ip TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  window_started_at TEXT NOT NULL,
  locked_until TEXT
);
