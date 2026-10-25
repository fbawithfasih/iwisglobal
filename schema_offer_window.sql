-- Countdown offers (src/lib/offers.ts, src/lib/offerTimer.ts): an automatic offer
-- with window_minutes applies only if the booking is made within that many
-- minutes of the visitor first opening a tour page. The start time is a signed
-- cookie set by /api/offer-timer (only with cookie consent where it is needed),
-- checked again by create-order. NULL = an ordinary offer. Additive only;
-- apply before deploying the code that reads it.
ALTER TABLE offers ADD COLUMN window_minutes INTEGER;
