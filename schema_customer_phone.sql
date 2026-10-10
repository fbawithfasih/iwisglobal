-- Optional phone number saved on a customer account, stored as
-- "+<code> <digits>" (the PhoneInput format). Edited on /account/bookings.
ALTER TABLE customers ADD COLUMN phone TEXT;
