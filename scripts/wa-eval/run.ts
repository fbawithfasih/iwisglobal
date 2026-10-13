// Evaluation for the WhatsApp reply agent (milestone 2). Builds an in-memory
// database from the repo's schema files, loads the tour snapshot, builds the
// knowledge base from the site's own text with every entry approved, then runs
// each question in questions.json through the real draft generator (real model
// calls, so it needs ANTHROPIC_API_KEY) and scores the drafts. Nothing touches
// production data and nothing is sent. Run with scripts/wa-eval/run.sh.
//
// questions.json fields: q (the guest message), person (true: a person must
// handle it, false: the agent should draft a usable answer, "either": not
// checked), include (regexes that must match the draft), exclude (regexes that
// must not). In `include`, {inr:slug} and {usd:slug} stand for that tour's price.
//
// Pass criteria that matter most: every person:true case must come back marked
// "needs a person" (a miss means a refund, complaint or booking change could be
// answered by the agent), and no draft may match an `exclude` pattern.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { storeWebhook } from '../../src/lib/whatsapp';
import { siteSourceItems, proposeFromItems, approveEntry } from '../../src/lib/waKnowledge';
import { generateDraft, catalogueText, COMPOSE_MODEL, CLASSIFY_MODEL } from '../../src/lib/waDraft';
import { groundingCheck } from '../../src/lib/waAuto';
import { retrieve } from '../../src/lib/waKnowledge';
import { listTours } from '../../src/lib/tours';

const root = process.cwd() + '/';
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('Set ANTHROPIC_API_KEY (for example: export $(grep ANTHROPIC_API_KEY .env)) and run again.');
  process.exit(2);
}

interface Question {
  q: string;
  person: boolean | 'either';
  include?: string[];
  exclude?: string[];
  // WhatsApp number (digits) the message comes from; matters for booking-status cases.
  sender?: string;
}
interface TourFixture {
  id: string;
  slug: string;
  title: string;
  duration_label: string;
  start_point: string;
  amount: number;
  usd_amount: number | null;
  tiers: { travelers: number; amount: number }[];
  itinerary?: { time: string; activity: string }[];
}

// EVAL_ONLY="regex" runs just the questions that match, for quick reruns.
const only = process.env.EVAL_ONLY ? new RegExp(process.env.EVAL_ONLY, 'i') : null;
const questions: Question[] = (JSON.parse(readFileSync(root + 'scripts/wa-eval/questions.json', 'utf8')) as Question[]).filter((c) => !only || only.test(c.q));
const tours: TourFixture[] = JSON.parse(readFileSync(root + 'scripts/wa-eval/tours.json', 'utf8'));

const sql = new DatabaseSync(':memory:');
const schemas = readdirSync(root).filter((f) => f.startsWith('schema') && f.endsWith('.sql')).sort();
// Some schema files depend on others; two passes, ignoring statements that already ran.
for (let pass = 0; pass < 2; pass++) {
  for (const f of schemas) {
    try {
      sql.exec(readFileSync(root + f, 'utf8'));
    } catch {
      // later pass picks it up
    }
  }
}
sql.exec('DELETE FROM tours');
sql.exec('DELETE FROM tour_pricing_tiers');
sql.exec('DELETE FROM tour_addons');
for (const t of tours) {
  sql
    .prepare(
      `INSERT INTO tours (id, slug, title, summary, description, duration_label, start_point, amount, usd_amount, currency, highlights, itinerary, includes, excludes, image, featured, status, created_at, updated_at)
       VALUES (?, ?, ?, '', '', ?, ?, ?, ?, 'INR', '[]', ?, '[]', '[]', '', 0, 'published', '2026-01-01', '2026-01-01')`
    )
        .run(t.id, t.slug, t.title, t.duration_label, t.start_point, t.amount, t.usd_amount, JSON.stringify(t.itinerary ?? []));
  for (const tier of t.tiers) {
    sql
      .prepare(`INSERT INTO tour_pricing_tiers (id, tour_id, travelers, amount, created_at) VALUES (?, ?, ?, ?, '2026-01-01')`)
      .run(`${t.id}-${tier.travelers}`, t.id, tier.travelers, tier.amount);
  }
}

// Fixed clock so "tomorrow" and "this Saturday" mean the same thing every run:
// Tuesday 13 October 2026, 10:00 India time.
const NOW = new Date('2026-10-13T04:30:00Z');

// Bookings for the status, balance and capacity cases. Amounts are minor units.
const bookingColumns = sql.prepare('PRAGMA table_info(bookings)').all() as { name: string; type: string; notnull: number; dflt_value: unknown; pk: number }[];
const fixtureBookings: Record<string, string | number>[] = [
  { id: 'EV1', payment_id: 'ev-pay-1', order_id: 'ev-o-1', tour_id: 'TAJ_MAHAL_SUNRISE_TOUR', travel_date: '2026-11-03', travelers: 2, traveler_name: 'Eval One', traveler_email: 'eval1@example.invalid', traveler_phone: '+91 90000 00001', amount_paid: 1599800, total_amount: 1599800, currency: 'INR', status: 'confirmed', pickup_time: '5:30 AM' },
  { id: 'EV2', payment_id: 'ev-pay-2', order_id: 'ev-o-2', tour_id: 'TAJ_MAHAL_LUXURY_CAR_TOUR', travel_date: '2026-11-10', travelers: 1, traveler_name: 'Eval Two', traveler_email: 'eval2@example.invalid', traveler_phone: '+91 90000 00002', amount_paid: 874800, total_amount: 3499000, currency: 'INR', status: 'confirmed', pickup_time: '' },
  { id: 'EV3', payment_id: 'ev-pay-3', order_id: 'ev-o-3', tour_id: 'SAME_DAY_AGRA_DELHI', travel_date: '2026-10-20', travelers: 11, traveler_name: 'Eval Three', traveler_email: 'eval3@example.invalid', traveler_phone: '+44 7000 000000', amount_paid: 100, total_amount: 100, currency: 'INR', status: 'confirmed', pickup_time: '' },
];
for (const b of fixtureBookings) {
  const row: Record<string, string | number> = {};
  for (const c of bookingColumns) if (c.notnull && c.dflt_value === null && !c.pk) row[c.name] = /INT|REAL/i.test(c.type) ? 0 : 'x';
  Object.assign(row, b, { created_at: '2026-10-01T00:00:00.000Z' });
  const names = Object.keys(row);
  sql.prepare(`INSERT INTO bookings (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...Object.values(row));
}

const db: any = {
  prepare: (q: string) => ({
    bind: (...v: any[]) => ({
      run: async () => ({ meta: { changes: Number(sql.prepare(q).run(...v).changes) } }),
      first: async () => sql.prepare(q).get(...v) ?? null,
      all: async () => ({ results: sql.prepare(q).all(...v) }),
    }),
  }),
};

// ---- knowledge base from the site's markdown, everything approved
function frontmatter(md: string): { data: Record<string, string>; body: string } {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const data: Record<string, string> = {};
  for (const line of (m?.[1] ?? '').split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) data[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  return { data, body: m?.[2] ?? md };
}
const read = (dir: string) =>
  readdirSync(root + dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({ slug: f.replace(/\.md$/, ''), ...frontmatter(readFileSync(root + dir + '/' + f, 'utf8')) }));

const guides = read('src/content/guides').map((g) => ({ slug: g.slug, title: g.data.title ?? g.slug, description: g.data.description ?? '', body: g.body }));
const attractions = read('src/content/attractions').map((a) => ({
  slug: a.slug,
  name: a.data.name ?? a.slug,
  hours: a.data.hours ?? '',
  ticketPriceForeign: a.data.ticketPriceForeign ?? '',
  ticketPriceIndian: a.data.ticketPriceIndian ?? '',
  ticketPriceSaarc: a.data.ticketPriceSaarc,
  closedFriday: a.data.closedFriday === 'true',
  distanceFromTaj: a.data.distanceFromTaj ?? '',
}));
await proposeFromItems(db, siteSourceItems(guides, attractions));
const entryIds = sql.prepare(`SELECT id FROM wa_kb_entries`).all() as { id: number }[];
for (const row of entryIds) await approveEntry(db, row.id, 'eval');

// ---- run
const bySlug = new Map(tours.map((t) => [t.slug, t]));
const withCommas = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '[,. \\u00a0\\u202f]?');
const rateFor = (t: TourFixture, n: number) => {
  const tiers = [...t.tiers].sort((a, b) => a.travelers - b.travelers);
  let rate = tiers.length ? tiers[0].amount : t.amount;
  for (const tier of tiers) if (tier.travelers <= n) rate = tier.amount;
  return rate;
};
// {inr_total:slug:n}, {usd_total:slug:n} and {inr_deposit:slug:n}: what checkout charges for n travellers.
const expandTotals = (pattern: string) =>
  pattern.replace(/\{(inr_total|usd_total|inr_deposit):([^:}]+):(\d+)\}/g, (_, kind: string, slug: string, n: string) => {
    const t = bySlug.get(slug);
    if (!t) throw new Error(`unknown tour in questions.json: ${slug}`);
    const total = rateFor(t, Number(n)) * Number(n);
    if (kind === 'usd_total') return String((t.usd_amount ?? 0) * Number(n));
    return withCommas(kind === 'inr_deposit' ? Math.ceil(total * 0.25) : total);
  });
const expand = (pattern: string) =>
  expandTotals(pattern).replace(/\{(inr|usd):([^}]+)\}/g, (_, kind: string, slug: string) => {
    const t = bySlug.get(slug);
    if (!t) throw new Error(`unknown tour in questions.json: ${slug}`);
    // Tiered tours are charged by group size, so any tier's price is a correct rupee answer.
    if (kind === 'inr') return `(${(t.tiers.length ? t.tiers.map((x) => x.amount) : [t.amount]).map(withCommas).join('|')})`;
    return String(t.usd_amount);
  });

interface Result {
  index: number;
  q: string;
  problems: string[];
  critical: boolean;
  reason: string;
  body: string;
  decision: string;
}

async function runOne(i: number, c: Question): Promise<Result> {
  const message = {
    waMessageId: `eval.${i}`,
    phone: c.sender ?? `91000${String(i).padStart(5, '0')}`,
    direction: 'in' as const,
    kind: 'text',
    body: c.q,
    profileName: null,
    sentAt: new Date().toISOString(),
  };
  await storeWebhook(db, { messages: [message], statuses: [] });
  await generateDraft({ ANTHROPIC_API_KEY: apiKey }, db, message, NOW);
  const d = sql.prepare(`SELECT needs_person, reason, body, auto_decision FROM wa_drafts WHERE message_id = ?`).get(message.waMessageId) as
    | { needs_person: number; reason: string; body: string; auto_decision: string }
    | undefined;
  if (!d) return { index: i, q: c.q, problems: ['no draft saved'], critical: true, reason: '', body: '', decision: '' };

  const problems: string[] = [];
  let critical = false;
  if (d.reason === 'error' || d.reason === 'no_api_key') problems.push(`generation failed (${d.reason})`);
  if (c.person === true && !d.needs_person) {
    problems.push('HAND-OFF MISS: should need a person');
    critical = true;
  }
  if (c.person === false && d.needs_person) problems.push(`unexpected hand-off (${d.reason})`);
  if (!d.needs_person) {
    for (const p of c.include ?? []) if (!new RegExp(expand(p), 'i').test(d.body)) problems.push(`missing: ${p}`);
  }
  for (const p of c.exclude ?? []) {
    if (new RegExp(expand(p), 'i').test(d.body)) {
      problems.push(`FORBIDDEN TEXT: ${p}`);
      critical = true;
    }
  }
  return { index: i, q: c.q, problems, critical, reason: d.reason, body: d.body, decision: d.auto_decision };
}

console.log(`Models: classify ${CLASSIFY_MODEL}, compose ${COMPOSE_MODEL}`);
console.log(`${questions.length} questions, ${entryIds.length} approved knowledge entries\n`);

const results: Result[] = [];
const BATCH = 4;
for (let i = 0; i < questions.length; i += BATCH) {
  const batch = questions.slice(i, i + BATCH).map((c, k) => runOne(i + k, c));
  results.push(...(await Promise.all(batch)));
}

const failed = results.filter((r) => r.problems.length);
for (const r of failed) {
  console.log(`#${r.index + 1} ${r.critical ? '[CRITICAL] ' : ''}${r.q}`);
  for (const p of r.problems) console.log(`    - ${p}`);
  if (r.body) console.log(`    draft: ${r.body.replace(/\s+/g, ' ').slice(0, 600)}`);
}

const count = (re: RegExp) => results.filter((r) => r.problems.some((p) => re.test(p))).length;
const priceFlags = results.filter((r) => r.reason === 'price_mismatch').length;
console.log('\n---- report');
console.log(`passed:                 ${results.length - failed.length} / ${results.length}`);
console.log(`hand-off misses:        ${count(/HAND-OFF MISS/)}   (must be 0)`);
console.log(`forbidden text:         ${count(/FORBIDDEN/)}   (must be 0)`);
console.log(`unexpected hand-offs:   ${count(/unexpected hand-off/)}`);
console.log(`missing facts:          ${count(/^missing/)}`);
console.log(`generation failures:    ${count(/generation failed/)}`);
console.log(`drafts flagged for a price not in the sources: ${priceFlags}`);

// ---- automatic-reply readiness: the grounding check (src/lib/waAuto.ts)
// 1. Drafts that passed every other check should be judged good enough to send.
const goodDrafts = results.filter((r) => !r.problems.length && questions[r.index].person === false && r.decision !== 'blocked:intent_never' && r.body);
const goodPassed = goodDrafts.filter((r) => r.decision === 'eligible').length;
const personSlips = results.filter((r) => questions[r.index].person === true && r.decision === 'eligible');
// 2. Deliberately wrong drafts must be rejected.
interface WrongDraft { guest: string; draft: string; defect: string }
const wrongDrafts: WrongDraft[] = JSON.parse(readFileSync(root + 'scripts/wa-eval/wrong-drafts.json', 'utf8'));
const catalogue = catalogueText(await listTours(db, { status: 'published' }));
const missed: WrongDraft[] = [];
for (let i = 0; i < wrongDrafts.length; i += BATCH) {
  await Promise.all(
    wrongDrafts.slice(i, i + BATCH).map(async (w) => {
      const entries = await retrieve(db, w.guest);
      const sources = `${catalogue}\n${entries.map((e) => `${e.question}\n${e.answer}`).join('\n\n')}`;
      const g = await groundingCheck(apiKey, { guest: w.guest, draft: w.draft, sources });
      if (g.ok) missed.push(w);
    })
  );
}
for (const w of missed) console.log(`GROUNDING MISS (${w.defect}): ${w.draft}`);
const goodRate = goodDrafts.length ? goodPassed / goodDrafts.length : 0;
const rejectRate = wrongDrafts.length ? (wrongDrafts.length - missed.length) / wrongDrafts.length : 0;
console.log('\n---- automatic-reply readiness');
console.log(`good drafts judged sendable:  ${goodPassed} / ${goodDrafts.length}  (${Math.round(goodRate * 100)}%, want 95% or more)`);
console.log(`wrong drafts rejected:        ${wrongDrafts.length - missed.length} / ${wrongDrafts.length}  (${Math.round(rejectRate * 100)}%, want 95% or more)`);
console.log(`needs-a-person drafts marked sendable: ${personSlips.length}   (must be 0)`);
process.exit(failed.some((r) => r.critical) || rejectRate < 0.95 || personSlips.length > 0 ? 1 : 0);
