// The WhatsApp reply agent's knowledge base (milestone 2): question-and-answer
// entries built from the site's own text, approved by a person before the agent
// may use them. Only 'approved' entries are in the search index (wa_kb_fts), so
// retrieval cannot return anything a person has not signed off. Tables:
// schema_whatsapp_kb.sql. Used by src/lib/waDraft.ts and /admin/whatsapp/knowledge.
import type { D1Like } from './db';
import { en } from '../i18n/en';

export const SITE_URL = 'https://www.iwisglobal.com';

export type KbStatus = 'proposed' | 'approved' | 'retired';

export interface KbEntry {
  id: number;
  question: string;
  answer: string;
  source: string;
  source_ref: string;
  status: KbStatus;
  approved_at: string | null;
  updated_at: string;
}

export interface KbSourceItem {
  source: string;
  ref: string;
  question: string;
  answer: string;
}

// Plain data from the markdown collections, read by the admin page (the
// collections only resolve inside Astro).
export interface GuideSource {
  slug: string;
  title: string;
  description: string;
  body: string;
}
export interface AttractionSource {
  slug: string;
  name: string;
  hours: string;
  ticketPriceForeign: string;
  ticketPriceIndian: string;
  ticketPriceSaarc?: string;
  closedFriday: boolean;
  distanceFromTaj: string;
}

export function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripMarkdown(value: string): string {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/[*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const GUIDE_BODY_CHARS = 1200;

// Policy pages keep their text in the English dictionary (src/i18n/en.ts), the
// same strings the pages render. Entries point at those keys, never copy text.
const dict = en as unknown as Record<string, Record<string, string>>;
const part = (page: string, keys: string[]) => keys.map((k) => stripHtml(dict[page][k])).join(' ');
const row = (page: string, a: string, b: string) => `${stripHtml(dict[page][a])}: ${stripHtml(dict[page][b])}.`;

function policyItems(): KbSourceItem[] {
  return [
    {
      source: 'policy',
      ref: 'cancel-refunds',
      question: 'What is your cancellation and refund policy?',
      answer: [
        stripHtml(dict.cancelPage.k2),
        row('cancelPage', 'k6', 'k7'),
        row('cancelPage', 'k8', 'k9'),
        row('cancelPage', 'k10', 'k11'),
        stripHtml(dict.cancelPage.k12),
        `Details: ${SITE_URL}/cancellation-refund-policy`,
      ].join(' '),
    },
    {
      source: 'policy',
      ref: 'cancel-by-us',
      question: 'What happens if you cancel my tour?',
      answer: `${part('cancelPage', ['k15'])} Details: ${SITE_URL}/cancellation-refund-policy`,
    },
    {
      source: 'policy',
      ref: 'change-date',
      question: 'Can I change my tour date?',
      answer: `${part('cancelPage', ['k17'])} Details: ${SITE_URL}/cancellation-refund-policy`,
    },
    {
      source: 'policy',
      ref: 'refund-timeline',
      question: 'How long does a refund take?',
      answer: part('cancelPage', ['k19', 'k20', 'k21']),
    },
    {
      source: 'policy',
      ref: 'contact',
      question: 'How can I contact IWIS Global, and what is your email address?',
      answer: `Email ${stripHtml(dict.cancelPage.k25)} or message us on ${stripHtml(dict.cancelPage.k26)}.`,
    },
    {
      source: 'policy',
      ref: 'delivery',
      question: 'How is my booking confirmed and delivered?',
      answer: `${part('shippingPage', ['k3', 'k5', 'k6', 'k8'])} Details: ${SITE_URL}/shipping-policy`,
    },
    {
      source: 'policy',
      ref: 'tour-day',
      question: 'How does the tour day work, and when can I book?',
      answer: `${part('shippingPage', ['k10', 'k11', 'k12', 'k13'])} Details: ${SITE_URL}/shipping-policy`,
    },
  ];
}

// The Founding Guest line is time-limited, so the FAQ placeholder is left out.
function faqItems(): KbSourceItem[] {
  const help = en.help as { categories: { items: { id: string; question: string; answer: string }[] }[] };
  return help.categories.flatMap((c) =>
    c.items.map((i) => ({
      source: 'faq',
      ref: i.id,
      question: i.question,
      answer: stripHtml(i.answer.replace('{founding}', '')),
    }))
  );
}

export function siteSourceItems(guides: GuideSource[], attractions: AttractionSource[]): KbSourceItem[] {
  return [
    ...faqItems(),
    ...policyItems(),
    ...guides.map((g) => ({
      source: 'guide',
      ref: g.slug,
      question: g.title,
      answer: `${g.description} ${stripMarkdown(g.body).slice(0, GUIDE_BODY_CHARS)} Read more: ${SITE_URL}/guides/${g.slug}`,
    })),
    ...attractions.map((a) => ({
      source: 'attraction',
      ref: a.slug,
      question: `What are the opening hours and ticket prices for ${a.name}?`,
      answer: [
        `Hours: ${a.hours}.`,
        `Foreign visitors: ${a.ticketPriceForeign}.`,
        `Indian visitors: ${a.ticketPriceIndian}.`,
        a.ticketPriceSaarc ? `SAARC/BIMSTEC: ${a.ticketPriceSaarc}.` : '',
        a.closedFriday ? 'Closed on Fridays.' : 'Open on Fridays.',
        `Distance from the Taj Mahal: ${a.distanceFromTaj}.`,
        `Details: ${SITE_URL}/agra/${a.slug}`,
      ]
        .filter(Boolean)
        .join(' '),
    })),
  ];
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Keeps the search index in step with an entry: present when approved, absent
// otherwise.
async function syncIndex(db: D1Like, id: number): Promise<void> {
  await db.prepare(`DELETE FROM wa_kb_fts WHERE entry_id = ?`).bind(id).run();
  const entry = await db.prepare(`SELECT question, answer, status FROM wa_kb_entries WHERE id = ?`).bind(id).first<KbEntry>();
  if (entry?.status === 'approved') {
    await db.prepare(`INSERT INTO wa_kb_fts (text, entry_id) VALUES (?, ?)`).bind(`${entry.question} ${entry.answer}`, id).run();
  }
}

// Creates a proposed entry for each new source item, and re-proposes an
// existing one only when its source text changed (so an edited or approved
// entry is left alone while its source is unchanged).
export async function proposeFromItems(db: D1Like, items: KbSourceItem[]): Promise<{ created: number; updated: number }> {
  const now = new Date().toISOString();
  let created = 0;
  let updated = 0;
  for (const item of items) {
    const hash = await sha256Hex(`${item.question}\n${item.answer}`);
    const existing = await db
      .prepare(`SELECT id, source_hash FROM wa_kb_entries WHERE source = ? AND source_ref = ?`)
      .bind(item.source, item.ref)
      .first<{ id: number; source_hash: string }>();
    if (!existing) {
      await db
        .prepare(
          `INSERT INTO wa_kb_entries (question, answer, source, source_ref, source_hash, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'proposed', ?, ?)`
        )
        .bind(item.question, item.answer, item.source, item.ref, hash, now, now)
        .run();
      created++;
    } else if (existing.source_hash !== hash) {
      await db
        .prepare(
          `UPDATE wa_kb_entries SET question = ?, answer = ?, source_hash = ?, status = 'proposed',
             approved_by = NULL, approved_at = NULL, updated_at = ? WHERE id = ?`
        )
        .bind(item.question, item.answer, hash, now, existing.id)
        .run();
      await syncIndex(db, existing.id);
      updated++;
    }
  }
  return { created, updated };
}

export async function approveEntry(db: D1Like, id: number, by: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(`UPDATE wa_kb_entries SET status = 'approved', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ? AND status != 'retired'`)
    .bind(by, now, now, id)
    .run();
  await syncIndex(db, id);
}

export async function retireEntry(db: D1Like, id: number): Promise<void> {
  await db.prepare(`UPDATE wa_kb_entries SET status = 'retired', updated_at = ? WHERE id = ?`).bind(new Date().toISOString(), id).run();
  await syncIndex(db, id);
}

export async function editEntry(db: D1Like, id: number, question: string, answer: string): Promise<void> {
  await db
    .prepare(`UPDATE wa_kb_entries SET question = ?, answer = ?, updated_at = ? WHERE id = ?`)
    .bind(question.trim(), answer.trim(), new Date().toISOString(), id)
    .run();
  await syncIndex(db, id);
}

// An entry a person wrote: approved at once, since the person is the source.
export async function addStaffEntry(db: D1Like, question: string, answer: string, by: string): Promise<void> {
  const now = new Date().toISOString();
  const ref = crypto.randomUUID();
  const inserted = await db
    .prepare(
      `INSERT INTO wa_kb_entries (question, answer, source, source_ref, status, approved_by, approved_at, created_at, updated_at)
       VALUES (?, ?, 'staff', ?, 'approved', ?, ?, ?, ?)`
    )
    .bind(question.trim(), answer.trim(), ref, by, now, now, now)
    .run();
  if (!inserted.meta?.changes) return;
  const row = await db.prepare(`SELECT id FROM wa_kb_entries WHERE source = 'staff' AND source_ref = ?`).bind(ref).first<{ id: number }>();
  if (row) await syncIndex(db, row.id);
}

export async function listEntries(db: D1Like, status: KbStatus): Promise<KbEntry[]> {
  const { results } = await db
    .prepare(
      `SELECT id, question, answer, source, source_ref, status, approved_at, updated_at
       FROM wa_kb_entries WHERE status = ? ORDER BY source, question LIMIT 500`
    )
    .bind(status)
    .all<KbEntry>();
  return results;
}

const STOP_WORDS = new Set(['the', 'and', 'for', 'you', 'are', 'can', 'how', 'what', 'does', 'with', 'this', 'that', 'your', 'have', 'from', 'will', 'there', 'about', 'hello', 'please', 'thanks', 'thank', 'would', 'could', 'tell', 'want', 'need', 'know']);

export function searchTerms(question: string): string[] {
  const words = question.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
  return [...new Set(words.filter((w) => !STOP_WORDS.has(w)))].slice(0, 12);
}

// Approved entries that best match the guest's message. Full-text search first;
// if the search itself fails (a query FTS5 rejects), a plain LIKE match over
// approved entries answers instead.
export async function retrieve(db: D1Like, question: string, limit = 5): Promise<KbEntry[]> {
  const terms = searchTerms(question);
  if (!terms.length) return [];
  try {
    const match = terms.map((t) => `"${t}"`).join(' OR ');
    const { results } = await db
      .prepare(
        `SELECT e.id, e.question, e.answer, e.source, e.source_ref, e.status, e.approved_at, e.updated_at
         FROM wa_kb_fts f JOIN wa_kb_entries e ON e.id = f.entry_id
         WHERE wa_kb_fts MATCH ? AND e.status = 'approved' ORDER BY rank LIMIT ?`
      )
      .bind(match, limit)
      .all<KbEntry>();
    return results;
  } catch (err) {
    console.error('whatsapp kb: full-text search failed, using LIKE', err);
    const clauses = terms.map(() => `(question LIKE ? OR answer LIKE ?)`).join(' OR ');
    const binds = terms.flatMap((t) => [`%${t}%`, `%${t}%`]);
    const { results } = await db
      .prepare(
        `SELECT id, question, answer, source, source_ref, status, approved_at, updated_at
         FROM wa_kb_entries WHERE status = 'approved' AND (${clauses}) LIMIT ?`
      )
      .bind(...binds, limit)
      .all<KbEntry>();
    return results;
  }
}

// What guests asked that the knowledge base could not answer, most frequent first.
export async function listGaps(db: D1Like): Promise<{ question: string; count: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT lower(m.body) AS question, COUNT(*) AS count
       FROM wa_drafts d JOIN wa_messages m ON m.wa_message_id = d.message_id
       WHERE d.reason = 'no_knowledge' GROUP BY lower(m.body) ORDER BY count DESC, MAX(m.sent_at) DESC LIMIT 20`
    )
    .bind()
    .all<{ question: string; count: number }>();
  return results;
}
