-- Email delivery events and aggregate click counts (src/lib/resendEvents.ts, src/pages/r/[code].ts). Additive.
-- Apply ONCE, before deploying the code that reads it:
--   wrangler d1 execute iwisglobal-bookings --remote --file=schema_events.sql

-- One row per Resend webhook delivery. svix_id is Resend's unique message id, so a retried delivery is ignored.
-- No email address is stored here: resend_id links the event to campaign_sends.
CREATE TABLE IF NOT EXISTS email_events (
  svix_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  resend_id TEXT NOT NULL DEFAULT '',
  campaign_id TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_events_campaign ON email_events (campaign_id, type);

-- The links a campaign may redirect to. The /r/<code> redirect only ever goes to a URL stored here.
CREATE TABLE IF NOT EXISTS campaign_links (
  code TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_campaign_links_campaign ON campaign_links (campaign_id);

-- Clicks per link per day. Aggregate only: no person, address or IP is recorded.
CREATE TABLE IF NOT EXISTS campaign_clicks (
  code TEXT NOT NULL,
  day TEXT NOT NULL,
  clicks INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (code, day)
);
