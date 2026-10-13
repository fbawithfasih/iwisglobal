-- WhatsApp reply agent, milestone 3 (.claude/plans/whatsapp-reply-agent-m3.plan.md):
-- the lookups a draft relied on, as a JSON array of {name, args, result}, so
-- staff can see what the draft checked. Used by src/lib/waDraft.ts and shown
-- in /admin/whatsapp. Apply to production before deploying the code that
-- writes it.
ALTER TABLE wa_drafts ADD COLUMN tools TEXT NOT NULL DEFAULT '[]';
