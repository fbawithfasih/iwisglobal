-- Double opt-in for marketing email (src/lib/marketing.ts). Additive. Apply ONCE, before deploying the code that reads it:
--   wrangler d1 execute iwisglobal-bookings --remote --file=schema_marketing.sql
-- The link carries a random token; only its SHA-256 hash is stored, as for password-reset links.
CREATE TABLE IF NOT EXISTS email_confirmations (
  token_hash TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  email TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en',
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_confirmations_person ON email_confirmations (person_id, created_at);
CREATE INDEX IF NOT EXISTS idx_email_confirmations_email ON email_confirmations (email, created_at);
