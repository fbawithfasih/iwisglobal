// Translated database content. English lives in the item's own table. Other
// languages come from two places, merged in this order:
//   1. JSON files in the repo, src/content-i18n/<kind>/<locale>.json, mapping an
//      item id to its translated fields (versioned and reviewed like code);
//   2. rows in content_translations (schema_translations.sql), which override
//      the files field by field, so content can be corrected without a deploy.
// Reading merges the result over the English original, so anything not
// translated yet shows in English instead of blank. A failed or missing
// lookup also falls back to English.

import type { D1Like } from './db';
import type { Locale } from './i18n';

export type TranslationKind = 'tour' | 'tour_addon' | 'blog_post' | 'agra_highlight';
export type TranslatedFields = Record<string, unknown>;

// The repo's JSON files, loaded on demand (one chunk per kind and language).
const bundled = import.meta.glob('../content-i18n/*/*.json', { import: 'default' }) as Record<
  string,
  () => Promise<Record<string, TranslatedFields>>
>;

async function loadBundled(kind: TranslationKind, locale: Locale): Promise<Record<string, TranslatedFields>> {
  const load = bundled[`../content-i18n/${kind}/${locale}.json`];
  if (!load) return {};
  try {
    return await load();
  } catch {
    return {};
  }
}

// One lookup for many items: id -> translated fields.
export async function loadTranslations(
  db: D1Like,
  kind: TranslationKind,
  locale: Locale,
  ids: string[]
): Promise<Map<string, TranslatedFields>> {
  const out = new Map<string, TranslatedFields>();
  if (locale === 'en' || ids.length === 0) return out;
  const files = await loadBundled(kind, locale);
  for (const id of ids) if (files[id]) out.set(id, files[id]);
  try {
    const marks = ids.map(() => '?').join(',');
    const { results } = await db
      .prepare(`SELECT ref_id, data FROM content_translations WHERE kind = ? AND locale = ? AND ref_id IN (${marks})`)
      .bind(kind, locale, ...ids)
      .all<{ ref_id: string; data: string }>();
    for (const row of results) {
      try {
        // A database row overrides the file field by field.
        out.set(row.ref_id, { ...(out.get(row.ref_id) ?? {}), ...(JSON.parse(row.data) as TranslatedFields) });
      } catch {
        /* a malformed row is ignored: that item stays English */
      }
    }
  } catch {
    /* table not there yet, or D1 hiccup: English */
  }
  return out;
}

// Copies the listed fields from `tr` onto `base` when they are present and
// not empty. Types must match the English field (string for string, array for array).
export function overlay<T extends object>(base: T, tr: TranslatedFields | undefined, fields: (keyof T & string)[]): T {
  if (!tr) return base;
  const next = { ...base } as Record<string, unknown>;
  for (const f of fields) {
    const v = tr[f];
    const orig = (base as Record<string, unknown>)[f];
    const ok = typeof orig === 'string' ? typeof v === 'string' && v.trim() !== '' : Array.isArray(orig) ? Array.isArray(v) && v.length > 0 : false;
    if (ok) next[f] = v;
  }
  return next as T;
}
