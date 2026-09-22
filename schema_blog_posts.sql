-- D1-backed blog, managed from /admin/blog — mirrors the tours.ts pattern
-- (id = machine key, slug = URL slug, status = draft/published) rather
-- than the git-based content collections (guides/attractions), since
-- posts need to be publishable from a browser form without a redeploy.
CREATE TABLE IF NOT EXISTS blog_posts (
  id TEXT PRIMARY KEY,                       -- e.g. WE_JUST_LAUNCHED
  slug TEXT NOT NULL UNIQUE,                  -- e.g. we-just-launched
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',              -- markdown, rendered at request time via `marked`
  category TEXT NOT NULL DEFAULT 'news',      -- 'news' | 'travel-tips' | 'seasonal'
  author_name TEXT NOT NULL DEFAULT 'IWIS Global',
  image TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',       -- 'draft' | 'published'
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  date_published TEXT                         -- set once, the first time status becomes 'published'
);

CREATE INDEX IF NOT EXISTS idx_blog_posts_status ON blog_posts(status, date_published);
