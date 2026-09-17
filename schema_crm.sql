-- Phase 2 (CRM) additions: booking status/itinerary fields, notes, and leads.

ALTER TABLE bookings ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed';
ALTER TABLE bookings ADD COLUMN source TEXT NOT NULL DEFAULT 'website';
ALTER TABLE bookings ADD COLUMN pickup_time TEXT NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN guide_assigned TEXT NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN vehicle TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS booking_notes (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_booking_notes_booking ON booking_notes (booking_id);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  tour_interest TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status);
