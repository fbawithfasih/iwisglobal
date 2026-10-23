-- Email campaigns (src/lib/campaigns.ts). Additive. Apply ONCE, before deploying the code that reads it:
--   wrangler d1 execute iwisglobal-bookings --remote --file=schema_campaigns.sql
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,                        -- cmp_<uuid>
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',       -- draft | scheduled | sending | sent | cancelled
  segment_json TEXT NOT NULL DEFAULT '{}',
  scheduled_at TEXT,
  tested_at TEXT,                             -- last test send, a real send needs one
  started_at TEXT,
  finished_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- One row per language. A machine translation is saved with reviewed = 0 and is never sent until a person approves it.
CREATE TABLE IF NOT EXISTS campaign_content (
  campaign_id TEXT NOT NULL,
  language TEXT NOT NULL,                     -- en | de | fr | es
  subject TEXT NOT NULL DEFAULT '',
  preheader TEXT NOT NULL DEFAULT '',
  headline TEXT NOT NULL DEFAULT '',
  intro TEXT NOT NULL DEFAULT '',
  block1 TEXT NOT NULL DEFAULT '',
  block2 TEXT NOT NULL DEFAULT '',
  block3 TEXT NOT NULL DEFAULT '',
  tour_slug TEXT NOT NULL DEFAULT '',
  cta_label TEXT NOT NULL DEFAULT '',
  cta_url TEXT NOT NULL DEFAULT '',
  reviewed INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, language)
);

-- The send ledger: one row per person per campaign, so nobody can be sent the same campaign twice.
CREATE TABLE IF NOT EXISTS campaign_sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  email TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  status TEXT NOT NULL DEFAULT 'queued',      -- queued | sent | failed | skipped
  resend_id TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  queued_at TEXT NOT NULL,
  sent_at TEXT,
  UNIQUE (campaign_id, person_id)
);
CREATE INDEX IF NOT EXISTS idx_campaign_sends_status ON campaign_sends (campaign_id, status, id);
CREATE INDEX IF NOT EXISTS idx_campaign_sends_sent ON campaign_sends (sent_at);
