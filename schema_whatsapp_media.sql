-- Photos, voice notes, videos, documents and stickers on WhatsApp, plus the
-- details Meta sends for locations, contact cards, reactions and messages it
-- cannot pass on (an edited or deleted message, a poll...). Additive only;
-- apply before deploying the code that reads these columns
-- (src/lib/whatsapp.ts, src/lib/waMedia.ts, /admin/whatsapp).
--
-- `media_id` is Meta's media ID (downloadable for 30 days); the file itself is
-- copied to R2 under wa-media/<wa_messages.id>, which src/pages/images/ does
-- NOT serve: only the admin route src/pages/admin/api/whatsapp/media/[id].ts
-- does, behind the admin login. `meta_json` holds the small extras (caption,
-- file name, coordinates, Meta's reason for an unsupported message).
ALTER TABLE wa_messages ADD COLUMN media_id TEXT;
ALTER TABLE wa_messages ADD COLUMN media_mime TEXT;
ALTER TABLE wa_messages ADD COLUMN meta_json TEXT;
