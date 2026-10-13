-- WhatsApp reply agent, milestone 5 (.claude/plans/whatsapp-reply-agent-m5.plan.md):
-- automatic replies. Used by src/lib/waAuto.ts and src/lib/waDraft.ts. Apply to
-- production before deploying the code that writes these. Auto-reply starts OFF
-- with no intents enabled.

-- Who sent a draft: 'staff' (a person pressed Send) or 'auto' (the agent).
ALTER TABLE wa_drafts ADD COLUMN sent_by TEXT NOT NULL DEFAULT 'staff';
-- 1 when staff changed the text before sending it.
ALTER TABLE wa_drafts ADD COLUMN edited INTEGER NOT NULL DEFAULT 0;
-- The weekly audit of automatic messages: '', 'ok' or 'wrong'.
ALTER TABLE wa_drafts ADD COLUMN audit TEXT NOT NULL DEFAULT '';
-- Recorded for every draft, even with auto-reply off: 'eligible', or
-- 'blocked:<reason>' (needs_person, low_confidence, length, grounding, intent_never).
ALTER TABLE wa_drafts ADD COLUMN auto_decision TEXT NOT NULL DEFAULT '';

INSERT OR IGNORE INTO wa_settings (key, value, updated_at) VALUES ('auto_intents', '[]', '2026-10-13T00:00:00.000Z');
INSERT OR IGNORE INTO wa_settings (key, value, updated_at) VALUES ('auto_hold', 'off', '2026-10-13T00:00:00.000Z');
INSERT OR IGNORE INTO wa_settings (key, value, updated_at) VALUES ('auto_min_confidence', '0.8', '2026-10-13T00:00:00.000Z');
INSERT OR IGNORE INTO wa_settings (key, value, updated_at) VALUES ('auto_per_chat_hour', '3', '2026-10-13T00:00:00.000Z');
INSERT OR IGNORE INTO wa_settings (key, value, updated_at) VALUES ('auto_daily_cap', '100', '2026-10-13T00:00:00.000Z');
