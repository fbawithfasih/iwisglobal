// Launch readiness for the WhatsApp reply agent (milestone 7): the launch gates
// from the PRD as pass / fail with the numbers behind them, the safety
// self-checks, and the four pilot measures from real traffic. Everything here
// only reads, except two settings rows that remember the latest evaluation and
// the latest self-check. Page: /admin/whatsapp/launch.
import type { D1Like } from './db';
import { autoPermission, getAutoSettings, readiness, MIN_REVIEWED_TOTAL } from './waAuto';
import { GRAPH_API_VERSION } from './whatsapp';
import { AI_GUIDE_MODEL } from './aiGuide';
import { redact } from './waLearning';

export const EVAL_MAX_AGE_DAYS = 14;
export const SELFCHECK_MAX_AGE_DAYS = 7;
export const MIN_EVAL_QUESTIONS = 100;
export const ACCURACY_TARGET = 0.95;
export const PILOT_DAYS = 28;
export const RESOLVED_TARGET = 0.6;
export const FIRST_REPLY_TARGET_MS = 60 * 1000;
export const AUDIT_OVERDUE_DAYS = 7;
export const BUSINESS_NUMBER_SUFFIX = '916399226633';

const DAY_MS = 24 * 60 * 60 * 1000;
const MONEY_INTENTS = ['payment_or_refund', 'complaint', 'booking_change', 'group_or_custom', 'safety_or_medical'];

// ------------------------------------------------------------------ settings rows

async function readJson<T>(db: D1Like, key: string): Promise<T | null> {
  const row = await db.prepare(`SELECT value FROM wa_settings WHERE key = ?`).bind(key).first<{ value: string }>();
  try {
    return row?.value ? (JSON.parse(row.value) as T) : null;
  } catch {
    return null;
  }
}

async function writeJson(db: D1Like, key: string, value: unknown): Promise<void> {
  await db
    .prepare(`INSERT INTO wa_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .bind(key, JSON.stringify(value), new Date().toISOString())
    .run();
}

// What scripts/wa-eval/run.sh prints on its RECORD line.
export interface EvalRecord {
  date: string;
  questions: number;
  passed: number;
  handoffMisses: number;
  forbidden: number;
  goodJudged: number;
  goodTotal: number;
  wrongRejected: number;
  wrongTotal: number;
  redactionClean: number;
  redactionTotal: number;
  gapAnswered: number;
  gapAnswerable: number;
  gapInvented: number;
}

const EVAL_FIELDS: (keyof EvalRecord)[] = [
  'questions', 'passed', 'handoffMisses', 'forbidden', 'goodJudged', 'goodTotal', 'wrongRejected', 'wrongTotal',
  'redactionClean', 'redactionTotal', 'gapAnswered', 'gapAnswerable', 'gapInvented',
];

// Reads the pasted RECORD line (or bare JSON); null when it is not a full record.
export function parseEvalRecord(text: string): EvalRecord | null {
  try {
    const json = JSON.parse(text.trim().replace(/^RECORD\s+/, ''));
    if (typeof json?.date !== 'string' || Number.isNaN(Date.parse(json.date))) return null;
    for (const f of EVAL_FIELDS) if (!Number.isFinite(json[f]) || json[f] < 0) return null;
    return Object.fromEntries([['date', json.date], ...EVAL_FIELDS.map((f) => [f, json[f]])]) as unknown as EvalRecord;
  } catch {
    return null;
  }
}

export const getEvalRecord = (db: D1Like) => readJson<EvalRecord>(db, 'launch_eval');
export const saveEvalRecord = (db: D1Like, r: EvalRecord) => writeJson(db, 'launch_eval', r);

// ------------------------------------------------------------------- self-checks

export interface SelfCheckItem {
  id: string;
  ok: boolean;
  detail: string;
}
export interface SelfCheck {
  at: string;
  items: SelfCheckItem[];
}

export const getSelfCheck = (db: D1Like) => readJson<SelfCheck>(db, 'launch_selfcheck');

const WA_SECRETS = ['WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_APP_SECRET', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'];

// Runs the safety checks and remembers the result. Makes exactly two outside
// calls that send nothing: one-word model call, one read of the phone number
// from Meta. The forged requests go to this site's own webhook.
export async function runSelfChecks(env: Record<string, any>, db: D1Like, origin: string, now: Date = new Date()): Promise<SelfCheck> {
  const items: SelfCheckItem[] = [];
  const add = (id: string, ok: boolean, detail: string) => items.push({ id, ok, detail });

  const missing = WA_SECRETS.filter((k) => !env[k]);
  add('secrets', missing.length === 0, missing.length ? `Not set in Cloudflare: ${missing.join(', ')}` : 'All four WhatsApp secrets are set.');

  const hook = `${origin}/api/webhooks/whatsapp`;
  const status = async (init: RequestInit, url = hook) => {
    try {
      return (await fetch(url, init)).status;
    } catch {
      return 0;
    }
  };
  // JSON like Meta's own posts: a body with no content type goes out as text/plain, and the site's cross-site form guard answers that with 403 before the webhook runs.
  const forged = await status({ method: 'POST', body: '{"entry":[]}', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) } });
  add('forged', forged === 401, forged === 401 ? 'A wrongly signed request was refused (401).' : forged === 503 ? 'The webhook says the app secret is not configured (503).' : `Expected 401, got ${forged || 'no answer'}.`);
  const unsigned = await status({ method: 'POST', body: '{"entry":[]}', headers: { 'content-type': 'application/json' } });
  add('unsigned', unsigned === 401, unsigned === 401 ? 'An unsigned request was refused (401).' : `Expected 401, got ${unsigned || 'no answer'}.`);
  const handshake = await status({ method: 'GET' }, `${hook}?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=1`);
  add('handshake', handshake === 403, handshake === 403 ? 'A wrong verify token was refused (403).' : `Expected 403, got ${handshake || 'no answer'}.`);

  if (env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID) {
    try {
      const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(env.WHATSAPP_PHONE_NUMBER_ID)}?fields=display_phone_number,verified_name`, {
        headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` },
      });
      const body: any = await res.json().catch(() => ({}));
      const digits = String(body?.display_phone_number ?? '').replace(/\D/g, '');
      if (!res.ok) add('meta', false, `Meta refused the request: ${body?.error?.message ?? res.status}`);
      else if (!digits.endsWith(BUSINESS_NUMBER_SUFFIX)) add('meta', false, `The phone number ID belongs to ${body?.display_phone_number ?? 'another number'}, not +91 6399226633.`);
      else add('meta', true, `Connected to ${body.display_phone_number}${body.verified_name ? ` (${body.verified_name})` : ''}.`);
    } catch {
      add('meta', false, 'Could not reach Meta.');
    }
  } else {
    add('meta', false, 'Needs the access token and the phone number ID.');
  }

  if (env.ANTHROPIC_API_KEY) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: AI_GUIDE_MODEL, max_tokens: 5, messages: [{ role: 'user', content: 'Reply with OK' }] }),
      });
      if (res.ok) add('ai', true, 'The AI service answered.');
      else {
        const body: any = await res.json().catch(() => ({}));
        add('ai', false, `The AI service refused the request: ${body?.error?.message ?? res.status}`);
      }
    } catch {
      add('ai', false, 'Could not reach the AI service.');
    }
  } else {
    add('ai', false, 'ANTHROPIC_API_KEY is not set.');
  }

  // With the switch off, a draft that would otherwise qualify must be refused.
  const live = await getAutoSettings(db);
  const refused = await autoPermission(db, { intent: 'greeting', phone: '0', messageSentAt: now.toISOString() }, { ...live, enabled: false, intents: ['greeting'] }, now);
  add('killswitch', refused === 'master_off', refused === 'master_off' ? `With the switch off nothing is sent. It is currently ${live.enabled ? 'ON' : 'off'}.` : `Expected "master_off", got "${refused}".`);

  const needed: [string, string][] = [
    ['wa_drafts', 'tools'], ['wa_drafts', 'sent_by'], ['wa_drafts', 'auto_decision'], ['wa_drafts', 'original_body'],
    ['wa_conversations', 'staff_active_at'], ['wa_kb_entries', 'evidence'],
  ];
  const absent: string[] = [];
  for (const [table, column] of needed) {
    const row = await db.prepare(`SELECT 1 AS ok FROM pragma_table_info('${table}') WHERE name = ?`).bind(column).first();
    if (!row) absent.push(`${table}.${column}`);
  }
  add('tables', absent.length === 0, absent.length ? `Missing in the database: ${absent.join(', ')}` : 'All database columns are present.');

  const inbound = await db.prepare(`SELECT COUNT(*) AS n FROM wa_messages WHERE direction = 'in'`).bind().first<{ n: number }>();
  add('inbound', (inbound?.n ?? 0) > 0, (inbound?.n ?? 0) > 0 ? `${inbound?.n} guest messages received so far.` : 'No guest message has reached the webhook yet.');

  const result = { at: now.toISOString(), items };
  await writeJson(db, 'launch_selfcheck', result);
  return result;
}

// ------------------------------------------------------------------------- gates

export type GateStatus = 'pass' | 'fail' | 'unknown';
export interface Gate {
  id: number;
  name: string;
  status: GateStatus;
  value: string;
  target: string;
  next: string;
}

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : 'n/a');
const ageDays = (iso: string, now: Date) => (now.getTime() - Date.parse(iso)) / DAY_MS;

// Automatic messages in money, complaint, change, group or medical chats that were
// not the short holding note: there must never be one.
async function liveBreaches(db: D1Like): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM wa_drafts WHERE sent_by = 'auto' AND status = 'sent' AND reason != 'handoff'
       AND intent IN (${MONEY_INTENTS.map(() => '?').join(',')})`
    )
    .bind(...MONEY_INTENTS)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function evaluateGates(db: D1Like, now: Date = new Date()): Promise<Gate[]> {
  const ev = await getEvalRecord(db);
  const sc = await getSelfCheck(db);
  const { reviewed } = await readiness(db);
  const breaches = await liveBreaches(db);
  const gates: Gate[] = [];

  const checkOf = (...ids: string[]) => {
    if (!sc) return { status: 'unknown' as GateStatus, detail: 'Self-checks have not been run.' };
    const bad = ids.map((id) => sc.items.find((i) => i.id === id)).filter((i) => !i || !i.ok);
    if (bad.length) return { status: 'fail' as GateStatus, detail: bad.map((i) => i?.detail ?? 'not run').join(' ') };
    if (ageDays(sc.at, now) > SELFCHECK_MAX_AGE_DAYS) return { status: 'fail' as GateStatus, detail: `Last run ${Math.floor(ageDays(sc.at, now))} days ago.` };
    return { status: 'pass' as GateStatus, detail: ids.map((id) => sc.items.find((i) => i.id === id)?.detail).join(' ') };
  };

  // 1. Accuracy on the evaluation
  if (!ev) {
    gates.push({ id: 1, name: 'Evaluation: at least 100 questions, 95% correct, nothing wrong', status: 'unknown', value: 'No evaluation recorded', target: `${MIN_EVAL_QUESTIONS}+ questions, ${ACCURACY_TARGET * 100}% correct`, next: 'Run scripts/wa-eval/run.sh and paste its RECORD line below.' });
  } else {
    const fresh = ageDays(ev.date, now) <= EVAL_MAX_AGE_DAYS;
    const passRate = ev.questions ? ev.passed / ev.questions : 0;
    const goodRate = ev.goodTotal ? ev.goodJudged / ev.goodTotal : 0;
    const rejectRate = ev.wrongTotal ? ev.wrongRejected / ev.wrongTotal : 0;
    const ok = fresh && ev.questions >= MIN_EVAL_QUESTIONS && passRate >= ACCURACY_TARGET && ev.forbidden === 0 && goodRate >= ACCURACY_TARGET && rejectRate >= ACCURACY_TARGET;
    gates.push({
      id: 1,
      name: 'Evaluation: at least 100 questions, 95% correct, nothing wrong',
      status: ok ? 'pass' : 'fail',
      value: `${ev.questions} questions, ${pct(ev.passed, ev.questions)} passed, ${ev.forbidden} forbidden, fact check accepts ${pct(ev.goodJudged, ev.goodTotal)} and rejects ${pct(ev.wrongRejected, ev.wrongTotal)} (${ev.date.slice(0, 10)})`,
      target: `${MIN_EVAL_QUESTIONS}+ questions, 95% each, 0 forbidden, run in the last ${EVAL_MAX_AGE_DAYS} days`,
      next: !fresh ? 'The evaluation is out of date: run it again.' : ev.questions < MIN_EVAL_QUESTIONS ? 'Add real questions with the export on this page.' : 'Fix the failures the evaluation printed, then run it again.',
    });
  }

  // 2. Hand-off
  const handoffOk = ev ? ev.handoffMisses === 0 : false;
  gates.push({
    id: 2,
    name: 'Refund, complaint and booking-change messages always reach a person',
    status: !ev ? 'unknown' : handoffOk && breaches === 0 ? 'pass' : 'fail',
    value: `${ev ? ev.handoffMisses : '?'} misses in the evaluation, ${breaches} answered automatically in real chats`,
    target: '0 and 0',
    next: breaches ? 'Open the audit list, find those messages and mark them Wrong.' : 'Run the evaluation and fix any hand-off miss.',
  });

  // 3 and 4. Kill switch and forged request
  const kill = checkOf('killswitch');
  gates.push({ id: 3, name: 'Kill switch works', status: kill.status, value: kill.detail, target: `Tested in the last ${SELFCHECK_MAX_AGE_DAYS} days`, next: 'Press Run self-checks.' });
  const forged = checkOf('forged', 'unsigned', 'handshake');
  gates.push({ id: 4, name: 'Forged webhook requests are refused', status: forged.status, value: forged.detail, target: `Tested in the last ${SELFCHECK_MAX_AGE_DAYS} days`, next: 'Set the WhatsApp secrets in Cloudflare, then run the self-checks.' });

  // 5. Reviewed drafts
  gates.push({ id: 5, name: 'You have reviewed 50 real drafts', status: reviewed >= MIN_REVIEWED_TOTAL ? 'pass' : 'fail', value: `${reviewed} reviewed`, target: `${MIN_REVIEWED_TOTAL}`, next: 'Send or discard real drafts in the chat view.' });

  // 6. Meta
  const meta = checkOf('secrets', 'meta', 'inbound');
  gates.push({ id: 6, name: 'Meta is connected and messages arrive', status: meta.status, value: meta.detail, target: 'Secrets set, number matches, one real message received', next: 'Finish the Meta setup in the runbook, then run the self-checks.' });

  // 7. AI service
  const ai = checkOf('ai');
  gates.push({ id: 7, name: 'The AI service is reachable', status: ai.status, value: ai.detail, target: 'Answers a test call', next: 'If it is out of credit, top up in the Anthropic console (Plans & Billing).' });

  return gates;
}

// ------------------------------------------------------------------ pilot metrics

export type Light = 'pass' | 'fail' | 'unknown';
export interface PilotMetrics {
  days: number;
  guestMessages: number;
  autoAnswered: number;
  draftUnedited: number;
  unanswered: number;
  resolvedShare: number;
  resolvedLight: Light;
  medianReplyMs: number | null;
  within1MinShare: number | null;
  replyLight: Light;
  byHour: { hour: number; n: number; within1Min: number }[];
  autoSent: number;
  audited: number;
  wrong: number;
  overdue: number;
  handoffMessages: number;
  handoffReached: number;
  handoffBreaches: number;
  handoffLight: Light;
  tokensPerDay: { day: string; input: number; output: number }[];
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

interface MetricRow {
  at: string;
  replied_at: string | null;
  sent_by: string | null;
  status: string | null;
  edited: number | null;
  intent: string | null;
  needs_person: number | null;
  reason: string | null;
}

export async function pilotMetrics(db: D1Like, now: Date = new Date(), days = PILOT_DAYS): Promise<PilotMetrics> {
  const since = new Date(now.getTime() - days * DAY_MS).toISOString();
  const { results } = await db
    .prepare(
      `SELECT m.sent_at AS at,
         (SELECT MIN(r.sent_at) FROM wa_messages r WHERE r.conversation_id = m.conversation_id AND r.direction != 'in' AND r.sent_at > m.sent_at) AS replied_at,
         d.sent_by, d.status, d.edited, d.intent, d.needs_person, d.reason
       FROM wa_messages m LEFT JOIN wa_drafts d ON d.message_id = m.wa_message_id
       WHERE m.direction = 'in' AND m.kind = 'text' AND m.sent_at >= ? ORDER BY m.sent_at DESC LIMIT 3000`
    )
    .bind(since)
    .all<MetricRow>();

  let autoAnswered = 0;
  let draftUnedited = 0;
  let unanswered = 0;
  const delays: number[] = [];
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, n: 0, within1Min: 0 }));
  let handoffMessages = 0;
  let handoffReached = 0;
  let handoffBreaches = 0;
  for (const r of results) {
    if (r.status === 'sent' && r.sent_by === 'auto') autoAnswered++;
    else if (r.status === 'sent' && r.sent_by === 'staff' && r.edited === 0) draftUnedited++;
    if (r.replied_at) {
      const delay = Date.parse(r.replied_at) - Date.parse(r.at);
      delays.push(delay);
      const hour = new Date(Date.parse(r.at) + 5.5 * 3600000).getUTCHours(); // India time
      hours[hour].n++;
      if (delay <= FIRST_REPLY_TARGET_MS) hours[hour].within1Min++;
    } else unanswered++;
    if (r.intent && MONEY_INTENTS.includes(r.intent)) {
      handoffMessages++;
      if (r.needs_person === 1) handoffReached++;
      if (r.status === 'sent' && r.sent_by === 'auto' && r.reason !== 'handoff') handoffBreaches++;
    }
  }
  const total = results.length;
  const resolvedShare = total ? (autoAnswered + draftUnedited) / total : 0;
  const med = median(delays);
  const within = delays.length ? delays.filter((d) => d <= FIRST_REPLY_TARGET_MS).length / delays.length : null;

  const audit = await db
    .prepare(
      `SELECT COUNT(*) AS sent,
         SUM(CASE WHEN audit != '' THEN 1 ELSE 0 END) AS audited,
         SUM(CASE WHEN audit = 'wrong' THEN 1 ELSE 0 END) AS wrong
       FROM wa_drafts WHERE sent_by = 'auto' AND status = 'sent' AND updated_at >= ?`
    )
    .bind(since)
    .first<{ sent: number; audited: number | null; wrong: number | null }>();
  const usage = await db
    .prepare(`SELECT day, input_tokens AS input, output_tokens AS output FROM wa_ai_usage WHERE day >= ? ORDER BY day DESC LIMIT 60`)
    .bind(since.slice(0, 10))
    .all<{ day: string; input: number; output: number }>();

  return {
    days,
    guestMessages: total,
    autoAnswered,
    draftUnedited,
    unanswered,
    resolvedShare,
    resolvedLight: !total ? 'unknown' : resolvedShare >= RESOLVED_TARGET ? 'pass' : 'fail',
    medianReplyMs: med,
    within1MinShare: within,
    replyLight: med === null ? 'unknown' : med <= FIRST_REPLY_TARGET_MS ? 'pass' : 'fail',
    byHour: hours,
    autoSent: audit?.sent ?? 0,
    audited: audit?.audited ?? 0,
    wrong: audit?.wrong ?? 0,
    overdue: await auditOverdue(db, now),
    handoffMessages,
    handoffReached,
    handoffBreaches,
    handoffLight: !handoffMessages ? 'unknown' : handoffBreaches === 0 && handoffReached === handoffMessages ? 'pass' : 'fail',
    tokensPerDay: usage.results,
  };
}

// Automatic messages sent more than a week ago that nobody has audited yet.
export async function auditOverdue(db: D1Like, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - AUDIT_OVERDUE_DAYS * DAY_MS).toISOString();
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM wa_drafts WHERE sent_by = 'auto' AND status = 'sent' AND audit = '' AND updated_at < ?`)
    .bind(cutoff)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export function formatMs(ms: number | null): string {
  if (ms === null) return 'n/a';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 90) return `${Math.round(s)} s`;
  return `${Math.round(s / 60)} min`;
}

// Plain-text weekly report for the owner's email.
export function weeklyReport(m: PilotMetrics, gates: Gate[]): string {
  const pctOf = (x: number | null) => (x === null ? 'n/a' : `${Math.round(x * 100)}%`);
  return [
    `WhatsApp agent, last ${m.days} days`,
    ``,
    `Guest messages: ${m.guestMessages} (${m.unanswered} not yet answered)`,
    `Answered automatically: ${m.autoAnswered}. Drafts sent unedited: ${m.draftUnedited}. Together ${pctOf(m.guestMessages ? m.resolvedShare : null)} (target 60%).`,
    `Median first reply: ${formatMs(m.medianReplyMs)}, ${pctOf(m.within1MinShare)} within a minute (target: median under 1 minute).`,
    `Automatic messages: ${m.autoSent}, audited ${m.audited}, marked wrong ${m.wrong}, overdue for audit ${m.overdue} (target: 0 wrong).`,
    `Refund, complaint and change messages: ${m.handoffMessages}, reached a person ${m.handoffReached}, answered automatically ${m.handoffBreaches} (target: all reach a person, 0 answered).`,
    ``,
    `Launch gates:`,
    ...gates.map((g) => `${g.status === 'pass' ? '[pass]' : g.status === 'fail' ? '[FAIL]' : '[unknown]'} ${g.name}: ${g.value}`),
  ].join('\n');
}

// ----------------------------------------------------------- real test questions

export interface RealCase {
  q: string;
  person: boolean;
  reference?: string;
  intent: string;
}

// Drafts staff reviewed, as evaluation cases. Questions and references are
// redacted; a question whose personal sentences leave nothing is skipped.
export async function exportTestCases(db: D1Like, limit = 500): Promise<RealCase[]> {
  const { results } = await db
    .prepare(
      `SELECT d.intent, d.needs_person, d.body, m.body AS guest, c.profile_name
       FROM wa_drafts d JOIN wa_messages m ON m.wa_message_id = d.message_id
       LEFT JOIN wa_conversations c ON c.id = d.conversation_id
       WHERE d.sent_by = 'staff' AND d.status = 'sent' AND m.kind = 'text' ORDER BY d.id DESC LIMIT ?`
    )
    .bind(limit)
    .all<{ intent: string; needs_person: number; body: string; guest: string; profile_name: string | null }>();
  const out: RealCase[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    const names = r.profile_name ? [r.profile_name] : [];
    const redacted = redact(r.guest, names);
    // A case that must reach a person keeps its whole sentence, with harmless stand-ins
    // for the personal details; any other case drops the sentences that held them.
    const q = (r.needs_person === 1
      ? redacted.replace(/\[ref\]/g, 'IWIS-0000').replace(/\[phone\]/g, '+00 00000 00000').replace(/\[name\]/g, 'Alex').replace(/\[email\]/g, 'guest@example.invalid').replace(/\[date\]/g, '2026-01-01')
      : redacted.split(/(?<=[.!?])\s+/).filter((s) => !/\[(?:email|phone|ref|date|name)\]/.test(s)).join(' ')
    ).replace(/\s+/g, ' ').trim();
    if (q.length < 8 || q.length > 300 || seen.has(q.toLowerCase())) continue;
    seen.add(q.toLowerCase());
    const reference = redact(r.body, names);
    out.push({ q, person: r.needs_person === 1, ...(r.needs_person === 1 || /\[(?:email|phone|ref|date|name)\]/.test(reference) ? {} : { reference }), intent: r.intent });
  }
  return out;
}
