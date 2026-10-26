-- WhatsApp inbox: which person is handling a chat, and who sent each reply (M4). Additive, two columns.
-- Run after schema_whatsapp.sql. The code that reads these columns needs them to exist, so apply this first.
--   handled_by  '' (nobody), 'owner' (the owner password login) or a team member's email. Cleared when the chat
--               goes back to the agent. Does not change who the agent drafts for; `state` still decides that.
--   sent_by     who sent an outgoing message from the admin (same values); '' for the agent and for older messages.
ALTER TABLE wa_conversations ADD COLUMN handled_by TEXT NOT NULL DEFAULT '';
ALTER TABLE wa_messages ADD COLUMN sent_by TEXT NOT NULL DEFAULT '';
