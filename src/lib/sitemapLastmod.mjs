// Last-modified dates for the sitemap (astro.config.mjs). Google uses <lastmod> to decide what to recrawl, but only when it is
// accurate, so a date is given only where the site really has one: a blog post's or tour's updated_at from the database, a guide's
// or attraction's dateModified from its markdown. Pages without a real date (the home page, policies) get none. Plain .mjs so the
// config can import it.

import { LOCALE_PREFIXES } from './localizedPaths.mjs';

/** A valid ISO date or date-time as an ISO string; undefined for anything else (and for a date in the future). */
export function toLastmod(value, nowMs = Date.now()) {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const ms = Date.parse(value.trim());
  if (!Number.isFinite(ms) || ms > nowMs + 86_400_000) return undefined;
  return new Date(ms).toISOString();
}

/** The dateModified (or another key) from a markdown file's front matter, as written (YYYY-MM-DD), or undefined. */
export function frontmatterDate(markdown, key = 'dateModified') {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (!block) return undefined;
  const line = block[1].split(/\r?\n/).find((l) => l.startsWith(`${key}:`));
  const raw = line?.slice(key.length + 1).trim().replace(/^["']|["']$/g, '');
  return raw && /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw : undefined;
}

/** The newest of several dates (ISO strings or undefined), or undefined when none is valid. */
export function newest(dates) {
  const valid = dates.map((d) => toLastmod(d)).filter(Boolean);
  return valid.length ? valid.sort().at(-1) : undefined;
}

/** The path of a sitemap URL without its language prefix: https://www.x.com/de/blog/a -> /blog/a ; the home page is '/'. */
export function pathWithoutLocale(url) {
  const path = new URL(url).pathname.replace(/\/$/, '') || '/';
  for (const l of LOCALE_PREFIXES) {
    if (path === `/${l}`) return '/';
    if (path.startsWith(`/${l}/`)) return path.slice(l.length + 1);
  }
  return path;
}

/** The lastmod for a sitemap URL from a Map of path -> ISO date, or undefined. Translations share the English page's date. */
export function lastmodFor(url, dates) {
  return dates.get(pathWithoutLocale(url));
}
