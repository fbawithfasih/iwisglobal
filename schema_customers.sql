-- Customer accounts (Google/Apple SSO — see src/lib/customerAuth.ts and
-- src/lib/oauth/*.ts). Separate from the single-admin auth in adminAuth.ts.
-- Guest checkout keeps working without an account: bookings.customer_id is
-- only set when the buyer was signed in at the time of booking, so it can
-- appear on their "My Bookings" page (src/pages/account/bookings.astro).

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  avatar_url TEXT,
  provider TEXT NOT NULL,      -- 'google' | 'apple'
  provider_sub TEXT NOT NULL,  -- the provider's stable unique subject id
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customers_provider ON customers (provider, provider_sub);

ALTER TABLE bookings ADD COLUMN customer_id TEXT;
CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings (customer_id);
