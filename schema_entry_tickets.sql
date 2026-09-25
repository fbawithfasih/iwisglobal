-- Monument entry-ticket fulfilment (admin "Tickets to buy" panel).
-- Additive only: existing rows get the defaults below.

-- Entry tickets built into a tour's price rather than sold as an add-on
-- (e.g. the Luxury tour's Taj + Agra Fort, the Same-Day tour's Agra Fort).
-- JSON array of ticket names, like highlights/includes.
ALTER TABLE tours ADD COLUMN entry_tickets_in_price TEXT NOT NULL DEFAULT '[]';

-- When staff bought the tickets on ASI's site for this booking.
ALTER TABLE bookings ADD COLUMN tickets_purchased_at TEXT;
-- Private R2 key of the uploaded e-ticket (tickets/<uuid>.<ext>); never
-- served by the public /images route.
ALTER TABLE bookings ADD COLUMN ticket_file_key TEXT;
-- When the e-ticket was emailed to the customer.
ALTER TABLE bookings ADD COLUMN ticket_emailed_at TEXT;
