-- One-time "forgot password" links for email/password accounts
-- (src/lib/passwordReset.ts). Only a SHA-256 hash of each token is stored, so
-- a leaked table can't be used to reset anyone's password. A link lasts one
-- hour and works once; using one also retires the account's other open links.
-- created_at also limits how many reset emails an account can trigger.

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_password_resets_customer ON password_resets (customer_id, created_at);
