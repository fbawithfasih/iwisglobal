-- Optional USD pricing alongside the existing INR amount. NULL means the
-- admin hasn't set a USD price for that tour/add-on yet — callers fall back
-- to INR in that case rather than guessing a conversion.

ALTER TABLE tours ADD COLUMN usd_amount INTEGER;
ALTER TABLE tour_addons ADD COLUMN usd_amount INTEGER;
