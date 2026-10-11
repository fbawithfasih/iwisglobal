-- The language the guest used when booking (es, fr, de; NULL or en = English), so
-- later emails (entry tickets, review request) are sent in it.
ALTER TABLE bookings ADD COLUMN locale TEXT;
