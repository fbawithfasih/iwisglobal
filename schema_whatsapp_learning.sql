-- WhatsApp reply agent, milestone 6 (.claude/plans/whatsapp-reply-agent-m6.plan.md):
-- the learning loop. Used by src/lib/waKnowledge.ts, src/lib/waLearning.ts and
-- src/lib/waDraft.ts. Apply to production before deploying the code that writes
-- these. All defaults are empty, so existing rows keep working.

-- The text an entry had before its source last changed, for the side-by-side view.
ALTER TABLE wa_kb_entries ADD COLUMN prev_question TEXT NOT NULL DEFAULT '';
ALTER TABLE wa_kb_entries ADD COLUMN prev_answer TEXT NOT NULL DEFAULT '';
-- Comma-separated review hints: 'figures' (the text contains a currency amount)
-- and 'source_removed' (the page or post it was built from no longer exists).
ALTER TABLE wa_kb_entries ADD COLUMN flag TEXT NOT NULL DEFAULT '';
-- JSON array of up to five redacted examples that led to the proposal.
ALTER TABLE wa_kb_entries ADD COLUMN evidence TEXT NOT NULL DEFAULT '[]';

-- What the draft said before staff edited it; empty when it was sent unchanged.
ALTER TABLE wa_drafts ADD COLUMN original_body TEXT NOT NULL DEFAULT '';

-- UTC date of the last retention clean-up (empty until the first one).
INSERT OR IGNORE INTO wa_settings (key, value, updated_at) VALUES ('last_purge', '', '2026-10-13T00:00:00.000Z');
