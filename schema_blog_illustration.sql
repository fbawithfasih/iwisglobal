-- Marks a blog cover that is an illustration (AI-generated or artwork), not
-- a photo, so the site labels it "Illustration" — readers shouldn't mistake
-- an invented scene for a real photo. Set from the admin blog editor.
ALTER TABLE blog_posts ADD COLUMN image_is_illustration INTEGER NOT NULL DEFAULT 0;
