-- WhatsApp reply agent, milestone 2 (.claude/plans/whatsapp-reply-agent-m2.plan.md):
-- the staff-approved knowledge base, the drafted replies, and a daily usage
-- counter. Used by src/lib/waKnowledge.ts and src/lib/waDraft.ts. Times are
-- ISO 8601 UTC strings.

-- One question-and-answer entry. `source` + `source_ref` identify where it was
-- built from ('faq' + the FAQ id, 'guide' + the slug, 'staff' + a random id).
-- `source_hash` is the hash of the source text when the entry was last built,
-- so a rebuild only touches entries whose source changed. `status`: 'proposed'
-- (never used), 'approved' (used for drafts), 'retired' (never used again).
CREATE TABLE IF NOT EXISTS wa_kb_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  source TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  source_hash TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'proposed',
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (source, source_ref)
);

CREATE INDEX IF NOT EXISTS idx_wa_kb_entries_status ON wa_kb_entries (status);

-- Search index over approved entries only. The app adds a row on approval and
-- removes it on retire, so a search can never return an unapproved entry.
CREATE VIRTUAL TABLE IF NOT EXISTS wa_kb_fts USING fts5(text, entry_id UNINDEXED, tokenize = 'porter unicode61');

-- One draft per guest message (`message_id` is Meta's message ID, UNIQUE).
-- `status`: 'draft' (waiting for staff), 'sending', 'sent', 'discarded'.
-- `reason` says why a person is needed: handoff (money, complaint, booking
-- change and the like), no_knowledge, price_mismatch, unsupported, format (the
-- model answered in plain text, check it), cap, no_api_key or error; empty when the draft is fine to send. `kb_ids` is a JSON array of
-- the entries the draft used.
CREATE TABLE IF NOT EXISTS wa_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL UNIQUE,
  conversation_id TEXT NOT NULL,
  intent TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0,
  needs_person INTEGER NOT NULL DEFAULT 1,
  reason TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  kb_ids TEXT NOT NULL DEFAULT '[]',
  model TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  sent_message_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wa_drafts_conversation ON wa_drafts (conversation_id, id);

-- Drafts generated per UTC day, and the tokens they used. The daily cap
-- (wa_settings key 'draft_daily_cap', default 300) is checked against `calls`.
CREATE TABLE IF NOT EXISTS wa_ai_usage (
  day TEXT PRIMARY KEY,
  calls INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0
);
