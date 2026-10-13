-- WhatsApp reply agent, milestone 1 (.claude/plans/whatsapp-reply-agent.plan.md):
-- every conversation and message on the business number, kept by the webhook
-- (src/pages/api/webhooks/whatsapp.ts, src/lib/whatsapp.ts). Times are ISO 8601
-- UTC strings. Later milestones add their own columns and tables.

-- One row per guest phone. `id` is the phone as WhatsApp gives it: digits with
-- the country code, no plus sign. `state` says who answers: 'agent' (the agent
-- may reply), 'staff' (a person has taken over), 'handed_off' (waiting for a
-- person) or 'opted_out' (the guest asked us to stop automatic replies).
CREATE TABLE IF NOT EXISTS wa_conversations (
  id TEXT PRIMARY KEY,
  profile_name TEXT,
  state TEXT NOT NULL DEFAULT 'agent',
  language TEXT,
  last_message_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wa_conversations_last ON wa_conversations (last_message_at);

-- `wa_message_id` is Meta's message ID. It is UNIQUE so a redelivered webhook
-- is stored once. `direction`: 'in' from the guest, 'out' sent by the agent
-- through the API, 'echo' sent by staff from the WhatsApp Business app.
-- `status` follows Meta's delivery updates: received, sent, delivered, read, failed.
CREATE TABLE IF NOT EXISTS wa_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wa_message_id TEXT NOT NULL UNIQUE,
  conversation_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'text',
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'received',
  sent_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wa_messages_conversation ON wa_messages (conversation_id, sent_at);

-- Switches the owner controls. `auto_reply` starts off and stays off until
-- milestone 5.
CREATE TABLE IF NOT EXISTS wa_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO wa_settings (key, value, updated_at) VALUES ('auto_reply', 'off', '2026-10-13T00:00:00.000Z');
