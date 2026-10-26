-- Staff accounts (M3): people other than the owner who use the admin, signed in with Google.
-- Additive: two tables and three indexes. The owner's own password login does not use these tables.
-- Roles: 'owner' (everything) and 'team' (everything except team management, the audit log, erasure and
-- system settings; see src/lib/authz.ts). A person is invited by email (status 'invited'), becomes 'active'
-- on their first Google sign-in with that address, and can be suspended at any time (takes effect on their
-- next request, because every request checks the session and the account).
CREATE TABLE IF NOT EXISTS staff_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  email_key TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'team' CHECK (role IN ('owner', 'team')),
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'suspended')),
  google_sub TEXT,
  invited_by TEXT,
  invited_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_email_key ON staff_users (email_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_google_sub ON staff_users (google_sub) WHERE google_sub IS NOT NULL;

-- One row per signed-in browser. The cookie holds a random token; only its SHA-256 is stored here.
CREATE TABLE IF NOT EXISTS staff_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_staff_sessions_user ON staff_sessions (user_id);
