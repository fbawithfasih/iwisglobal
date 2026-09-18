-- Tracks failed /admin/login attempts per IP so the login route can lock out
-- an IP after repeated failures instead of allowing unlimited password
-- guesses (see src/lib/loginAttempts.ts).

CREATE TABLE IF NOT EXISTS admin_login_attempts (
  ip TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  window_started_at TEXT NOT NULL,
  locked_until TEXT
);
