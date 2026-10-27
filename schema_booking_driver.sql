-- Bookings: the driver, who is the guest's first point of contact at pickup. Additive, two columns.
-- Run after schema_crm.sql. The code that saves these columns needs them to exist, so apply this first.
--   driver_name   the driver's name ('' when not set)
--   driver_phone  the driver's phone with country code ('' when not set)
ALTER TABLE bookings ADD COLUMN driver_name TEXT NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN driver_phone TEXT NOT NULL DEFAULT '';
