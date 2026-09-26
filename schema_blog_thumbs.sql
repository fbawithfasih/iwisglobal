-- Small (800px) copy of a blog cover for the /blog list, so phones don't
-- download the full 1200px cover for a ~330px-wide card. Empty = no copy
-- (the list falls back to the full image).
ALTER TABLE blog_posts ADD COLUMN image_thumb TEXT NOT NULL DEFAULT '';
