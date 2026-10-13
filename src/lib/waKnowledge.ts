// The WhatsApp reply agent's knowledge base (milestone 2): question-and-answer
// entries built from the site's own text, approved by a person before the agent
// may use them. Only 'approved' entries are in the search index (wa_kb_fts), so
// retrieval cannot return anything a person has not signed off. Tables:
// schema_whatsapp_kb.sql. Used by src/lib/waDraft.ts and /admin/whatsapp/knowledge.
import type { D1Like } from './db';
import { en } from '../i18n/en';
import type { ParsedTour } from './tours';

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
  // Only loaded by listEntries (the review queue).
  prev_question?: string;
  prev_answer?: string;
  flag?: string;
  evidence?: string;
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

export interface BlogSource {
  slug: string;
  title: string;
  description: string;
  body: string;
}

// A currency amount in the text. Amounts go stale and are answered by the live
// catalogue and tools, so a proposal containing one is flagged for the reviewer.
const MONEY = /[₹$€£]\s?\d|\b\d[\d,]*(?:\.\d+)?\s?(?:rupees?|inr|usd|dollars?)\b/i;
export const hasMoney = (text: string) => MONEY.test(text);

// Sources where an amount is unexpected. Attractions and policy pages legitimately quote them.
const FIGURE_CHECKED_SOURCES = new Set(['tour', 'blog', 'staff_edit', 'staff_reply', 'gap', 'import']);
export const flagsFor = (source: string, answer: string) => (FIGURE_CHECKED_SOURCES.has(source) && hasMoney(answer) ? 'figures' : '');

// Entries built from the site itself (as opposed to staff or learned ones).
const SITE_SOURCES = ['faq', 'policy', 'guide', 'attraction', 'tour', 'blog'];

const withFlag = (flag: string, add: string) => [...new Set([...flag.split(',').filter(Boolean), add])].join(',');
const withoutFlag = (flag: string, drop: string) => flag.split(',').filter((f) => f && f !== drop).join(',');

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

function tourItem(t: ParsedTour): KbSourceItem {
  const parts = [`Starts at: ${t.startPoint}.`, `Duration: ${t.durationLabel}.`];
  if (t.includes.length) parts.push(`Includes: ${t.includes.join('; ')}.`);
  if (t.excludes.length) parts.push(`Not included: ${t.excludes.join('; ')}.`);
  const stops = t.itinerary.map((step) => step.activity).filter(Boolean);
  if (stops.length) parts.push(`The day: ${stops.join('; ')}.`);
  if (t.privateTour) parts.push('Private tour, just your group.');
  if (t.pickupIncluded) parts.push('Hotel pickup is included.');
  parts.push(`Details and booking: ${SITE_URL}/tours/${t.slug}`);
  return { source: 'tour', ref: t.id, question: `What does the ${t.title} include, and how does it run?`, answer: parts.join(' ') };
}

// Tour facts never include prices: those always come from the live catalogue.
export function siteSourceItems(
  guides: GuideSource[],
  attractions: AttractionSource[],
  extra: { tours?: ParsedTour[]; posts?: BlogSource[] } = {}
): KbSourceItem[] {
  return [
    ...faqItems(),
    ...(extra.tours ?? []).map(tourItem),
    ...(extra.posts ?? []).map((p) => ({
      source: 'blog',
      ref: p.slug,
      question: p.title,
      answer: `${p.description} ${stripMarkdown(p.body).slice(0, GUIDE_BODY_CHARS)} Read more: ${SITE_URL}/blog/${p.slug}`,
    })),
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

export async function sha256Hex(value: string): Promise<string> {
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
// entry is left alone while its source is unchanged). A re-proposal keeps the
// old text for the side-by-side view. Entries whose source has gone are flagged.
export async function proposeFromItems(db: D1Like, items: KbSourceItem[]): Promise<{ created: number; updated: number; removed: number }> {
  const now = new Date().toISOString();
  let created = 0;
  let updated = 0;
  for (const item of items) {
    const hash = await sha256Hex(`${item.question}\n${item.answer}`);
    const flag = flagsFor(item.source, item.answer);
    const existing = await db
      .prepare(`SELECT id, source_hash, flag FROM wa_kb_entries WHERE source = ? AND source_ref = ?`)
      .bind(item.source, item.ref)
      .first<{ id: number; source_hash: string; flag: string }>();
    if (!existing) {
      await db
        .prepare(
          `INSERT INTO wa_kb_entries (question, answer, source, source_ref, source_hash, status, flag, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'proposed', ?, ?, ?)`
        )
        .bind(item.question, item.answer, item.source, item.ref, hash, flag, now, now)
        .run();
      created++;
    } else if (existing.source_hash !== hash) {
      await db
        .prepare(
          `UPDATE wa_kb_entries SET prev_question = question, prev_answer = answer,
             question = ?, answer = ?, source_hash = ?, status = 'proposed', flag = ?,
             approved_by = NULL, approved_at = NULL, updated_at = ? WHERE id = ?`
        )
        .bind(item.question, item.answer, hash, flag, now, existing.id)
        .run();
      await syncIndex(db, existing.id);
      updated++;
    } else if (existing.flag.includes('source_removed')) {
      await db.prepare(`UPDATE wa_kb_entries SET flag = ? WHERE id = ?`).bind(withoutFlag(existing.flag, 'source_removed'), existing.id).run();
    }
  }
  return { created, updated, removed: await markRemovedSources(db, items) };
}

// Site-built entries whose page, post or tour no longer exists get a
// "source removed" flag. Their status is left alone: a person decides.
async function markRemovedSources(db: D1Like, items: KbSourceItem[]): Promise<number> {
  const live = new Set(items.map((i) => `${i.source}:${i.ref}`));
  const { results } = await db
    .prepare(`SELECT id, source, source_ref, flag FROM wa_kb_entries WHERE source IN (${SITE_SOURCES.map(() => '?').join(',')}) AND status != 'retired'`)
    .bind(...SITE_SOURCES)
    .all<{ id: number; source: string; source_ref: string; flag: string }>();
  let flagged = 0;
  for (const r of results) {
    if (live.has(`${r.source}:${r.source_ref}`) || r.flag.includes('source_removed')) continue;
    await db.prepare(`UPDATE wa_kb_entries SET flag = ? WHERE id = ?`).bind(withFlag(r.flag, 'source_removed'), r.id).run();
    flagged++;
  }
  return flagged;
}

// What a build would do right now, without writing anything (for the banner).
export async function sourceChanges(db: D1Like, items: KbSourceItem[]): Promise<{ added: number; changed: number; removed: number }> {
  const { results } = await db
    .prepare(`SELECT source, source_ref, source_hash, status, flag FROM wa_kb_entries WHERE source IN (${SITE_SOURCES.map(() => '?').join(',')})`)
    .bind(...SITE_SOURCES)
    .all<{ source: string; source_ref: string; source_hash: string; status: string; flag: string }>();
  const stored = new Map(results.map((r) => [`${r.source}:${r.source_ref}`, r]));
  let added = 0;
  let changed = 0;
  for (const item of items) {
    const row = stored.get(`${item.source}:${item.ref}`);
    if (!row) added++;
    else if (row.source_hash !== (await sha256Hex(`${item.question}\n${item.answer}`))) changed++;
  }
  const live = new Set(items.map((i) => `${i.source}:${i.ref}`));
  const removed = results.filter((r) => r.status !== 'retired' && !live.has(`${r.source}:${r.source_ref}`) && !r.flag.includes('source_removed')).length;
  return { added, changed, removed };
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
      `SELECT id, question, answer, source, source_ref, status, approved_at, updated_at, prev_question, prev_answer, flag, evidence
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

// ------------------------------------------------------------ learned proposals

export interface Evidence {
  kind: string; // 'staff_edit', 'staff_reply', 'gap', 'import'
  question?: string;
  staff?: string;
  original?: string;
  note?: string;
}

// Another entry (in any state, so a rejected one is not offered again) whose
// question is the same or nearly the same.
export async function findSimilar(db: D1Like, question: string): Promise<{ id: number; status: string } | null> {
  const normal = (t: string) => (t.toLowerCase().match(/[a-z0-9]+/g) ?? []).join(' ');
  const mine = new Set(searchTerms(question));
  const { results } = await db.prepare(`SELECT id, question, status FROM wa_kb_entries LIMIT 2000`).bind().all<{ id: number; question: string; status: string }>();
  for (const r of results) {
    if (normal(r.question) === normal(question)) return { id: r.id, status: r.status };
    const theirs = new Set(searchTerms(r.question));
    if (mine.size < 2 || theirs.size < 2) continue;
    const shared = [...mine].filter((t) => theirs.has(t)).length;
    if (shared / (mine.size + theirs.size - shared) >= 0.75) return { id: r.id, status: r.status };
  }
  return null;
}

async function addEvidence(db: D1Like, id: number, ev: Evidence): Promise<void> {
  const row = await db.prepare(`SELECT evidence FROM wa_kb_entries WHERE id = ?`).bind(id).first<{ evidence: string }>();
  let list: Evidence[] = [];
  try {
    list = JSON.parse(row?.evidence ?? '[]');
  } catch {
    list = [];
  }
  if (list.some((e) => e.question === ev.question && e.staff === ev.staff && e.note === ev.note)) return;
  list.push(ev);
  await db.prepare(`UPDATE wa_kb_entries SET evidence = ?, updated_at = ? WHERE id = ?`).bind(JSON.stringify(list.slice(-5)), new Date().toISOString(), id).run();
}

// A learned proposal (from a staff edit, an app reply, a gap or an imported
// chat). Never used until a person approves it. 'duplicate' means an entry with
// the same question exists, so the example was attached to it as evidence.
export async function addProposal(
  db: D1Like,
  p: { source: string; ref: string; question: string; answer: string; evidence: Evidence }
): Promise<'created' | 'duplicate' | 'exists'> {
  const same = await db.prepare(`SELECT 1 FROM wa_kb_entries WHERE source = ? AND source_ref = ?`).bind(p.source, p.ref).first();
  if (same) return 'exists';
  const similar = await findSimilar(db, p.question);
  if (similar) {
    if (similar.status !== 'retired') await addEvidence(db, similar.id, p.evidence);
    return 'duplicate';
  }
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO wa_kb_entries (question, answer, source, source_ref, source_hash, status, flag, evidence, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'proposed', ?, ?, ?, ?)`
    )
    .bind(p.question, p.answer, p.source, p.ref, await sha256Hex(`${p.question}\n${p.answer}`), flagsFor(p.source, p.answer), JSON.stringify([p.evidence]), now, now)
    .run();
  return 'created';
}

// The questions of the given entries, for the audit view ("this reply used...").
export async function entryQuestions(db: D1Like, ids: number[]): Promise<Map<number, string>> {
  const clean = [...new Set(ids.filter((n) => Number.isInteger(n)))].slice(0, 50);
  if (!clean.length) return new Map();
  const { results } = await db
    .prepare(`SELECT id, question FROM wa_kb_entries WHERE id IN (${clean.map(() => '?').join(',')})`)
    .bind(...clean)
    .all<{ id: number; question: string }>();
  return new Map(results.map((r) => [r.id, r.question]));
}
