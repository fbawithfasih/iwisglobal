-- Booking notes: who wrote each note (M4). Additive, one column.
-- Run after schema_crm.sql. The code that writes this column needs it to exist, so apply this first.
--   author  '' (older notes, author unknown), 'owner' (the owner password login) or a team member's email.
ALTER TABLE booking_notes ADD COLUMN author TEXT NOT NULL DEFAULT '';
