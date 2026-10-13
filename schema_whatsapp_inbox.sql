-- WhatsApp reply agent, milestone 4 (.claude/plans/whatsapp-reply-agent-m4.plan.md):
-- hand-off and inbox bookkeeping on each conversation. Used by
-- src/lib/waInbox.ts. `state` already exists (agent, handed_off, staff,
-- opted_out). Apply to production before deploying the code that writes these.
ALTER TABLE wa_conversations ADD COLUMN handoff_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE wa_conversations ADD COLUMN handed_off_at TEXT;
ALTER TABLE wa_conversations ADD COLUMN last_alert_at TEXT;
ALTER TABLE wa_conversations ADD COLUMN staff_active_at TEXT;

CREATE INDEX IF NOT EXISTS idx_wa_conversations_state ON wa_conversations (state);
