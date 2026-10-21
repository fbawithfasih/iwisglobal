-- Unified contacts and lead management (src/lib/contacts.ts).
-- Additive only. Apply ONCE, before deploying code that reads it:
--   wrangler d1 execute iwisglobal-bookings --remote --file=schema_contacts.sql
-- The ALTER TABLE lines are not idempotent, so a second run fails on them (harmless:
-- everything above them is IF NOT EXISTS).

-- One row per real person. Merged duplicates keep their row, pointing at the survivor.
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,                       -- per_<uuid>
  display_name TEXT NOT NULL DEFAULT '',
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT '',
  -- Cached from consent_events: none | pending | subscribed | unsubscribed | bounced | complained
  marketing_status TEXT NOT NULL DEFAULT 'none',
  merged_into_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_people_merged ON people (merged_into_id);

-- Every way to reach a person. value_norm is the match key (lowercased email with the Gmail
-- dot/plus rules, E.164 phone, wa_id digits, Instagram/Messenger scoped ids).
CREATE TABLE IF NOT EXISTS person_identifiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id TEXT NOT NULL,
  type TEXT NOT NULL,                        -- email | phone | wa_id | ig_sid | fb_psid | ig_username
  value_raw TEXT NOT NULL,
  value_norm TEXT NOT NULL,
  is_shared INTEGER NOT NULL DEFAULT 0,      -- an agent's or a family's address: never auto-matched
  verified_at TEXT,
  source TEXT NOT NULL DEFAULT '',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_identifiers_unique ON person_identifiers (type, value_norm) WHERE is_shared = 0;
CREATE INDEX IF NOT EXISTS idx_identifiers_person ON person_identifiers (person_id);
CREATE INDEX IF NOT EXISTS idx_identifiers_lookup ON person_identifiers (type, value_norm);

-- Everything that ever touched us, append-only. external_ref makes webhook replays harmless
-- (a Meta lead id, a WhatsApp message id, a booking id, a form submission id).
CREATE TABLE IF NOT EXISTS touchpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id TEXT NOT NULL,
  lead_id TEXT,
  occurred_at TEXT NOT NULL,
  channel TEXT NOT NULL,                     -- website | whatsapp | fb_lead_ad | instagram_dm | facebook_dm | email | phone | manual | csv_import | booking | custom_trip | offer | marketplace
  type TEXT NOT NULL DEFAULT '',             -- form | message | lead_ad | call | booking | quote | import ...
  source TEXT NOT NULL DEFAULT '',
  medium TEXT NOT NULL DEFAULT '',
  campaign TEXT NOT NULL DEFAULT '',
  ad_id TEXT NOT NULL DEFAULT '',
  form_id TEXT NOT NULL DEFAULT '',
  ctwa_clid TEXT NOT NULL DEFAULT '',
  fbclid TEXT NOT NULL DEFAULT '',
  gclid TEXT NOT NULL DEFAULT '',
  utm_content TEXT NOT NULL DEFAULT '',
  utm_term TEXT NOT NULL DEFAULT '',
  referrer TEXT NOT NULL DEFAULT '',
  landing_page TEXT NOT NULL DEFAULT '',
  ref_tag TEXT NOT NULL DEFAULT '',          -- the "(ref: FLOATING-HOME)" tag of a WhatsApp click
  external_ref TEXT,
  import_batch_id TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_touchpoints_external ON touchpoints (channel, external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_touchpoints_person ON touchpoints (person_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_touchpoints_lead ON touchpoints (lead_id, occurred_at);

-- Notes, calls, tasks, stage changes and system events on a lead.
CREATE TABLE IF NOT EXISTS lead_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id TEXT NOT NULL,
  person_id TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,                        -- note | call | task | stage | system | email
  body TEXT NOT NULL DEFAULT '',
  due_at TEXT,
  done_at TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activities_lead ON lead_activities (lead_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activities_due ON lead_activities (due_at) WHERE kind = 'task' AND done_at IS NULL;

CREATE TABLE IF NOT EXISTS person_tags (
  person_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (person_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_person_tags_tag ON person_tags (tag);

-- Two people who might be one. A human decides; nothing here merges by itself.
CREATE TABLE IF NOT EXISTS duplicate_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_a TEXT NOT NULL,
  person_b TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',       -- open | merged | dismissed
  created_at TEXT NOT NULL,
  UNIQUE (person_a, person_b)
);

-- What a merge moved, so it can be undone.
CREATE TABLE IF NOT EXISTS merge_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kept_id TEXT NOT NULL,
  dropped_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  merged_by TEXT NOT NULL DEFAULT '',
  merged_at TEXT NOT NULL,
  undone_at TEXT
);

-- Consent: an append-only ledger, one row per change. Current state = the latest row per
-- person and channel. action: granted (box ticked) | confirmed (double opt-in clicked) | withdrawn.
CREATE TABLE IF NOT EXISTS consent_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id TEXT NOT NULL,
  channel TEXT NOT NULL,                     -- email | whatsapp
  purpose TEXT NOT NULL DEFAULT 'marketing',
  action TEXT NOT NULL,
  legal_basis TEXT NOT NULL DEFAULT 'consent',
  occurred_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',           -- website_form | meta_lead_ad | whatsapp | manual | import | unsubscribe_link
  source_url TEXT NOT NULL DEFAULT '',
  form_id TEXT NOT NULL DEFAULT '',
  text_version_id TEXT NOT NULL DEFAULT '',
  ip_hash TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  doi_sent_at TEXT,
  doi_confirmed_at TEXT,
  doi_token_hash TEXT NOT NULL DEFAULT '',
  entered_by TEXT NOT NULL DEFAULT '',
  evidence_ref TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_consent_person ON consent_events (person_id, channel, id);

-- The exact wording shown beside a consent box. Versioned, never edited: a change is a new row.
CREATE TABLE IF NOT EXISTS consent_texts (
  version_id TEXT NOT NULL,
  language TEXT NOT NULL,
  text TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  PRIMARY KEY (version_id, language)
);

-- Addresses we must never market to again. Permanent; survives deleting the person.
CREATE TABLE IF NOT EXISTS suppressions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,                     -- email | whatsapp
  identifier_hash TEXT NOT NULL,             -- sha-256 of the normalised address or number
  identifier_plain TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL,                      -- unsubscribe | complaint | hard_bounce | erasure | wa_stop | manual
  created_at TEXT NOT NULL,
  UNIQUE (channel, identifier_hash)
);

-- Money spent per channel and campaign, entered by hand, for cost per lead and per booking.
CREATE TABLE IF NOT EXISTS marketing_spend (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  spend_date TEXT NOT NULL,
  channel TEXT NOT NULL,
  campaign TEXT NOT NULL DEFAULT '',
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  note TEXT NOT NULL DEFAULT ''
);

-- The existing leads table grows into the unified inbox. `status` now carries the stage:
-- new | contacted | qualified | quote_sent | deposit_paid | booked | lost | spam
-- (the old 'converted' is read as 'booked'). Existing rows and the old admin keep working.
ALTER TABLE leads ADD COLUMN person_id TEXT;
ALTER TABLE leads ADD COLUMN channel TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE leads ADD COLUMN campaign TEXT NOT NULL DEFAULT '';
ALTER TABLE leads ADD COLUMN lost_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE leads ADD COLUMN score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE leads ADD COLUMN score_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE leads ADD COLUMN owner TEXT NOT NULL DEFAULT '';
ALTER TABLE leads ADD COLUMN first_response_at TEXT;
ALTER TABLE leads ADD COLUMN last_activity_at TEXT;
ALTER TABLE leads ADD COLUMN next_action_at TEXT;
ALTER TABLE leads ADD COLUMN travel_start TEXT NOT NULL DEFAULT '';
ALTER TABLE leads ADD COLUMN party_size INTEGER;
ALTER TABLE leads ADD COLUMN language TEXT NOT NULL DEFAULT '';
ALTER TABLE leads ADD COLUMN country TEXT NOT NULL DEFAULT '';
ALTER TABLE leads ADD COLUMN booking_id TEXT;
ALTER TABLE leads ADD COLUMN updated_at TEXT;
CREATE INDEX IF NOT EXISTS idx_leads_person ON leads (person_id);
CREATE INDEX IF NOT EXISTS idx_leads_activity ON leads (last_activity_at);
CREATE INDEX IF NOT EXISTS idx_leads_next_action ON leads (next_action_at) WHERE next_action_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_channel ON leads (channel);
