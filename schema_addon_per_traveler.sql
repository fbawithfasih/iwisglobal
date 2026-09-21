-- Backlog 0.3 — an add-on can now be per-traveler (e.g. a monument entry
-- ticket, charged amount × travelers) instead of the original flat
-- per-booking charge (e.g. a private art-gallery stop). Defaults to 0
-- (flat) so every existing add-on row keeps its current behavior.
ALTER TABLE tour_addons ADD COLUMN per_traveler INTEGER NOT NULL DEFAULT 0;
