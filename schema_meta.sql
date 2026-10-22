-- Meta (Facebook/Instagram) inbox for src/lib/meta.ts. Additive. Apply ONCE, before deploying the code that reads it:
--   wrangler d1 execute iwisglobal-bookings --remote --file=schema_meta.sql
-- Every webhook event is stored here first and processed after the reply to Meta, so a failure
-- while fetching a lead can be retried (by the poll job) instead of the lead being lost.
CREATE TABLE IF NOT EXISTS meta_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                        -- leadgen | dm
  external_id TEXT NOT NULL UNIQUE,          -- leadgen id, or message id (mid)
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',    -- pending | done | failed
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT '',
  lead_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_meta_events_status ON meta_events (status, updated_at);
