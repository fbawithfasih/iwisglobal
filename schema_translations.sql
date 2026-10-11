-- Translated versions of database-held content (tours, add-ons, blog posts,
-- Agra highlights). One row per item and language; `data` is a JSON object
-- holding only the fields that are translated, merged over the English
-- original when a page is shown in that language (see src/lib/translations.ts).
-- A missing row or field simply falls back to English.
CREATE TABLE IF NOT EXISTS content_translations (
  kind TEXT NOT NULL,        -- 'tour' | 'tour_addon' | 'blog_post' | 'agra_highlight'
  ref_id TEXT NOT NULL,      -- the item's id
  locale TEXT NOT NULL,      -- 'es' | 'fr' | 'de'
  data TEXT NOT NULL,        -- JSON of translated fields
  updated_at TEXT NOT NULL,
  PRIMARY KEY (kind, ref_id, locale)
);
