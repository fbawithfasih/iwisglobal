// Translated database content. English lives in the item's own table; other
// languages live in content_translations (schema_translations.sql) as a JSON
// object of just the translated fields. Reading merges them over the English
// original, so anything not translated yet shows in English instead of blank.
// A failed or missing lookup (table not created yet) also falls back to English.

import type { D1Like } from './db';
import type { Locale } from './i18n';

export type TranslationKind = 'tour' | 'tour_addon' | 'blog_post' | 'agra_highlight';
export type TranslatedFields = Record<string, unknown>;

// One query for many items: id -> translated fields.
export async function loadTranslations(
  db: D1Like,
  kind: TranslationKind,
  locale: Locale,
  ids: string[]
): Promise<Map<string, TranslatedFields>> {
  const out = new Map<string, TranslatedFields>();
  if (locale === 'en' || ids.length === 0) return out;
  try {
    const marks = ids.map(() => '?').join(',');
    const { results } = await db
      .prepare(`SELECT ref_id, data FROM content_translations WHERE kind = ? AND locale = ? AND ref_id IN (${marks})`)
      .bind(kind, locale, ...ids)
      .all<{ ref_id: string; data: string }>();
    for (const row of results) {
      try {
        out.set(row.ref_id, JSON.parse(row.data) as TranslatedFields);
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
