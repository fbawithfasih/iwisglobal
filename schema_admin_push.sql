-- Phone alerts for the admin (Web Push). One row per browser or Home Screen app
-- that pressed "Turn on alerts" on /admin/whatsapp. Used by src/lib/webPush.ts.
-- Apply once before deploying the code that writes it:
--   wrangler d1 execute iwisglobal-bookings --remote --file=schema_admin_push.sql
CREATE TABLE IF NOT EXISTS admin_push_subscriptions (
  endpoint TEXT PRIMARY KEY,   -- the push service URL for this device (secret-ish: treat as private)
  p256dh TEXT NOT NULL,        -- the device's public key, base64url
  auth TEXT NOT NULL,          -- the device's auth secret, base64url
  created_at TEXT NOT NULL
);
