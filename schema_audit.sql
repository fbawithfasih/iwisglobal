-- Admin audit log (M2, audit log only). Additive: one table, two indexes, two triggers.
-- Append-only: the triggers refuse UPDATE and DELETE, and no code path tries either.
-- Rows hold who did what and to which record, never customer contact details or message text.
-- Until staff accounts exist (M3) the actor is always 'owner'.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  resource TEXT,
  resource_id TEXT,
  summary TEXT,
  ip TEXT,
  meta_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON admin_audit_log (id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON admin_audit_log (action, id DESC);
CREATE TRIGGER IF NOT EXISTS admin_audit_no_update BEFORE UPDATE ON admin_audit_log
BEGIN SELECT RAISE(ABORT, 'admin_audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS admin_audit_no_delete BEFORE DELETE ON admin_audit_log
BEGIN SELECT RAISE(ABORT, 'admin_audit_log is append-only'); END;
