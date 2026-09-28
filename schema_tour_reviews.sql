-- Guest ratings for a tour (src/lib/reviews.ts). The admin "Request a
-- review" button gives the booking a random review_token and emails the
-- guest a link to /review?t=<token>, which is the only way to write a
-- review: one per booking, editable through the same link. Reviews start
-- as 'pending' and show on the site once the admin approves them.
ALTER TABLE bookings ADD COLUMN review_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_review_token ON bookings(review_token);

CREATE TABLE IF NOT EXISTS tour_reviews (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL UNIQUE,
  tour_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL,
  travel_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | hidden
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tour_reviews_tour ON tour_reviews(tour_id, status);
