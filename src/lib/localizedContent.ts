// Translated guides and Agra attractions. English stays in the content
// collections (src/content/**); other languages are markdown files in
// src/content-i18n/<kind>/<locale>/<slug>.md. A file has a small frontmatter
// (each line `key: "value"`, only the fields that differ, e.g. title,
// description, hours) and a markdown body. A missing file means "show English".
//
// Headings get an id so in-page links work. A heading can pin its own id with
// a trailing {#id}, which keeps links such as #sunrise-timing-by-season valid
// in every language.

import { marked } from 'marked';
import type { Locale } from './i18n';

export type LocalizedKind = 'guide' | 'attraction';

const files = import.meta.glob('../content-i18n/{guide,attraction}/*/*.md', { query: '?raw', import: 'default' }) as Record<
  string,
  () => Promise<string>
>;

export interface LocalizedEntry {
  fields: Record<string, string>;
  body: string;
  html: string;
}

function slugify(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/(^-|-$)/g, '');
}

export function renderMarkdown(body: string): string {
  const html = marked.parse(body, { async: false }) as string;
  return html.replace(/<h([2-4])>(.*?)<\/h\1>/g, (_m, level: string, inner: string) => {
    const pinned = inner.match(/^(.*?)\s*\{#([\w-]+)\}\s*$/);
    const text = pinned ? pinned[1] : inner;
    return `<h${level} id="${pinned ? pinned[2] : slugify(text)}">${text}</h${level}>`;
  });
}

function parse(raw: string): { fields: Record<string, string>; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { fields: {}, body: raw };
  const fields: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z]\w*):\s*(.*)$/);
    if (!kv) continue;
    const v = kv[2].trim();
    try {
      fields[kv[1]] = v.startsWith('"') ? (JSON.parse(v) as string) : v;
    } catch {
      fields[kv[1]] = v.replace(/^"|"$/g, '');
    }
  }
  return { fields, body: m[2] };
}

export async function localizedEntry(kind: LocalizedKind, locale: Locale, slug: string): Promise<LocalizedEntry | null> {
  if (locale === 'en') return null;
  const load = files[`../content-i18n/${kind}/${locale}/${slug}.md`];
  if (!load) return null;
  try {
    const { fields, body } = parse(await load());
    return { fields, body, html: renderMarkdown(body) };
  } catch {
    return null;
  }
}

// Copies the translated string fields over the English frontmatter.
export function overlayFields<T extends Record<string, unknown>>(data: T, entry: LocalizedEntry | null): T {
  if (!entry) return data;
  const out: Record<string, unknown> = { ...data };
  for (const [k, v] of Object.entries(entry.fields)) if (typeof out[k] === 'string' && v) out[k] = v;
  return out as T;
}
