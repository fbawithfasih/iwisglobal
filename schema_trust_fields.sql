-- Adds real, per-tour trust facts (not fabricated) used by the redesigned
-- tour cards/detail page: guide language, pickup inclusion, private-tour flag.

ALTER TABLE tours ADD COLUMN guide_language TEXT NOT NULL DEFAULT 'English';
ALTER TABLE tours ADD COLUMN pickup_included INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tours ADD COLUMN private_tour INTEGER NOT NULL DEFAULT 0;

UPDATE tours SET guide_language = 'English', pickup_included = 1, private_tour = 1
  WHERE id = 'SAME_DAY_AGRA_DELHI';
