import type { D1Like } from './db';
import { OPEN_STAGES, canonicalStage, logActivity, recordLead, refreshLeadScore, type Channel } from './contacts';
import { sendHotelAlertEmail } from './email';
import { sendAdminPush } from './webPush';

// Reads and small writes for the admin Leads screens (src/pages/admin/leads/*).

export interface LeadListRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  message: string;
  tour_interest: string;
  status: string;
  created_at: string;
  person_id: string | null;
  channel: string;
  campaign: string;
  score: number;
  next_action_at: string | null;
  first_response_at: string | null;
  last_activity_at: string | null;
  marketing_status: string | null;
}

export const STAGE_LABELS: Record<string, string> = {
  new: 'New', contacted: 'Contacted', qualified: 'Qualified', quote_sent: 'Quote sent', deposit_paid: 'Deposit paid', booked: 'Booked',
  converted: 'Booked', lost: 'Lost', spam: 'Spam',
};

export const VIEWS = [
  { key: 'unanswered', label: 'New and unanswered' },
  { key: 'followups', label: 'Follow-ups due' },
  { key: 'quotes', label: 'Quotes awaiting reply' },
  { key: 'hot', label: 'Hot' },
  { key: 'stale', label: 'Stale' },
  { key: 'duplicates', label: 'Possible duplicates' },
  { key: 'open', label: 'All open' },
  { key: 'closed', label: 'Booked, lost, spam' },
  { key: 'all', label: 'Everything' },
] as const;
export type ViewKey = (typeof VIEWS)[number]['key'];

const OPEN_SQL = `l.status IN ('new','contacted','qualified','quote_sent','deposit_paid')`;
const STALE_DAYS = 7;
const SELECT = `SELECT l.id, l.name, l.email, l.phone, l.message, l.tour_interest, l.status, l.created_at, l.person_id, l.channel, l.campaign, l.score,
  l.next_action_at, l.first_response_at, l.last_activity_at, p.marketing_status
  FROM leads l LEFT JOIN people p ON p.id = l.person_id`;

function viewWhere(view: ViewKey, nowIso: string): { sql: string; args: unknown[] } {
  const staleCutoff = new Date(Date.parse(nowIso) - STALE_DAYS * 86_400_000).toISOString();
  switch (view) {
    case 'unanswered':
      return { sql: `l.status = 'new'`, args: [] };
    case 'followups':
      return { sql: `${OPEN_SQL} AND l.next_action_at IS NOT NULL AND l.next_action_at <= ?`, args: [nowIso] };
    case 'quotes':
      return { sql: `l.status = 'quote_sent'`, args: [] };
    case 'hot':
      return { sql: `${OPEN_SQL} AND l.score >= 60`, args: [] };
    case 'stale':
      return { sql: `${OPEN_SQL} AND COALESCE(l.last_activity_at, l.created_at) < ?`, args: [staleCutoff] };
    case 'duplicates':
      return {
        sql: `l.person_id IN (SELECT person_a FROM duplicate_suggestions WHERE status = 'open' UNION SELECT person_b FROM duplicate_suggestions WHERE status = 'open')`,
        args: [],
      };
    case 'open':
      return { sql: OPEN_SQL, args: [] };
    case 'closed':
      return { sql: `l.status IN ('booked','converted','lost','spam')`, args: [] };
    default:
      return { sql: '1 = 1', args: [] };
  }
}

export interface ListQuery {
  view: ViewKey;
  channel?: string;
  stage?: string;
  q?: string;
  cursor?: string;
  limit?: number;
}

const sortKey = `COALESCE(l.last_activity_at, l.created_at)`;

// Newest activity first, paged by (activity time, id) so a page never skips or repeats a row.
export async function listLeadsView(db: D1Like, query: ListQuery, nowIso = new Date().toISOString()): Promise<{ rows: LeadListRow[]; next: string | null }> {
  const limit = Math.min(Math.max(query.limit ?? 30, 1), 100);
  const w = viewWhere(query.view, nowIso);
  const where: string[] = [w.sql];
  const args: unknown[] = [...w.args];
  if (query.channel) {
    where.push(`l.channel = ?`);
    args.push(query.channel);
  }
  if (query.stage) {
    where.push(`l.status = ?`);
    args.push(query.stage);
  }
  const q = (query.q ?? '').trim().slice(0, 80);
  if (q) {
    where.push(`(l.name LIKE ? OR l.email LIKE ? OR l.phone LIKE ? OR l.tour_interest LIKE ?)`);
    const like = `%${q.replace(/[%_]/g, '')}%`;
    args.push(like, like, like, like);
  }
  if (query.cursor) {
    const [at, id] = query.cursor.split('|');
    if (at && id) {
      where.push(`(${sortKey} < ? OR (${sortKey} = ? AND l.id < ?))`);
      args.push(at, at, id);
    }
  }
  const { results } = await db
    .prepare(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY ${sortKey} DESC, l.id DESC LIMIT ?`)
    .bind(...args, limit + 1)
    .all<LeadListRow>();
  const more = results.length > limit;
  const rows = more ? results.slice(0, limit) : results;
  const last = rows[rows.length - 1];
  return { rows, next: more && last ? `${last.last_activity_at ?? last.created_at}|${last.id}` : null };
}

export async function viewCounts(db: D1Like, nowIso = new Date().toISOString()): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const v of VIEWS) {
    const w = viewWhere(v.key, nowIso);
    const row = await db.prepare(`SELECT COUNT(*) AS n FROM leads l WHERE ${w.sql}`).bind(...w.args).first<{ n: number }>();
    out[v.key] = row?.n ?? 0;
  }
  return out;
}

// Leads that have waited more than an hour for a first reply.
export async function waitingTooLong(db: D1Like, nowIso = new Date().toISOString()): Promise<number> {
  const cutoff = new Date(Date.parse(nowIso) - 3_600_000).toISOString();
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM leads WHERE status = 'new' AND first_response_at IS NULL AND created_at < ?`)
    .bind(cutoff)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// ------------------------------------------------------------------ detail

export interface TimelineItem {
  at: string;
  kind: 'touchpoint' | 'note' | 'call' | 'task' | 'stage' | 'system' | 'email';
  title: string;
  detail: string;
  done?: boolean;
  activityId?: number;
}

export interface LeadDetail {
  lead: LeadListRow & { lost_reason: string; score_reason: string; travel_start: string; party_size: number | null; language: string; country: string; booking_id: string | null };
  person: { id: string; display_name: string; marketing_status: string; country: string; language: string } | null;
  identifiers: { type: string; value_raw: string; is_shared: number }[];
  timeline: TimelineItem[];
  duplicates: { id: number; other_id: string; other_name: string; reason: string }[];
  merges: { id: number; dropped_id: string; merged_at: string }[];
  tags: string[];
}

export async function getLeadDetail(db: D1Like, id: string): Promise<LeadDetail | null> {
  const lead = await db
    .prepare(
      `SELECT l.id, l.name, l.email, l.phone, l.message, l.tour_interest, l.status, l.created_at, l.person_id, l.channel, l.campaign, l.score,
         l.next_action_at, l.first_response_at, l.last_activity_at, p.marketing_status, l.lost_reason, l.score_reason, l.travel_start, l.party_size,
         l.language, l.country, l.booking_id
       FROM leads l LEFT JOIN people p ON p.id = l.person_id WHERE l.id = ?`
    )
    .bind(id)
    .first<LeadDetail['lead']>();
  if (!lead) return null;
  return buildDetail(db, lead);
}

async function buildDetail(db: D1Like, lead: LeadDetail['lead']): Promise<LeadDetail> {
  const pid = lead.person_id;
  const person = pid ? await db.prepare(`SELECT id, display_name, marketing_status, country, language FROM people WHERE id = ?`).bind(pid).first<NonNullable<LeadDetail['person']>>() : null;
  const identifiers = pid ? (await db.prepare(`SELECT type, value_raw, is_shared FROM person_identifiers WHERE person_id = ? ORDER BY type`).bind(pid).all<LeadDetail['identifiers'][number]>()).results : [];
  const timeline: TimelineItem[] = [];
  if (pid) {
    const { results: tps } = await db
      .prepare(`SELECT occurred_at, channel, type, source, medium, campaign, ref_tag, landing_page, referrer, ad_id FROM touchpoints WHERE person_id = ? ORDER BY occurred_at DESC LIMIT 100`)
      .bind(pid)
      .all<{ occurred_at: string; channel: string; type: string; source: string; medium: string; campaign: string; ref_tag: string; landing_page: string; referrer: string; ad_id: string }>();
    for (const t of tps) {
      const bits = [t.source && `source ${t.source}`, t.medium && `medium ${t.medium}`, t.campaign && `campaign ${t.campaign}`, t.ref_tag && `button ${t.ref_tag}`, t.ad_id && `ad ${t.ad_id}`, t.referrer && `from ${t.referrer}`, t.landing_page && `landed on ${t.landing_page}`].filter(Boolean);
      timeline.push({ at: t.occurred_at, kind: 'touchpoint', title: `${t.channel}${t.type ? ` (${t.type})` : ''}`, detail: bits.join(', ') });
    }
  }
  const { results: acts } = await db
    .prepare(`SELECT id, kind, body, due_at, done_at, created_by, created_at FROM lead_activities WHERE lead_id = ? ORDER BY created_at DESC LIMIT 200`)
    .bind(lead.id)
    .all<{ id: number; kind: TimelineItem['kind']; body: string; due_at: string | null; done_at: string | null; created_by: string; created_at: string }>();
  for (const a of acts) {
    timeline.push({
      at: a.created_at,
      kind: a.kind,
      title: a.kind === 'task' ? `Follow-up${a.due_at ? ` due ${a.due_at.slice(0, 10)}` : ''}` : a.kind,
      detail: a.body,
      done: !!a.done_at,
      activityId: a.id,
    });
  }
  timeline.sort((x, y) => (x.at < y.at ? 1 : -1));

  const duplicates = pid
    ? (
        await db
          .prepare(
            `SELECT d.id, CASE WHEN d.person_a = ? THEN d.person_b ELSE d.person_a END AS other_id, d.reason
               FROM duplicate_suggestions d WHERE d.status = 'open' AND (d.person_a = ? OR d.person_b = ?)`
          )
          .bind(pid, pid, pid)
          .all<{ id: number; other_id: string; reason: string }>()
      ).results
    : [];
  const dups: LeadDetail['duplicates'] = [];
  for (const d of duplicates) {
    const o = await db.prepare(`SELECT display_name FROM people WHERE id = ?`).bind(d.other_id).first<{ display_name: string }>();
    dups.push({ ...d, other_name: o?.display_name || d.other_id });
  }
  const merges = pid
    ? (await db.prepare(`SELECT id, dropped_id, merged_at FROM merge_log WHERE kept_id = ? AND undone_at IS NULL ORDER BY id DESC LIMIT 5`).bind(pid).all<LeadDetail['merges'][number]>()).results
    : [];
  const tags = pid ? (await db.prepare(`SELECT tag FROM person_tags WHERE person_id = ? ORDER BY tag`).bind(pid).all<{ tag: string }>()).results.map((t) => t.tag) : [];
  return { lead, person, identifiers, timeline, duplicates: dups, merges, tags };
}

// -------------------------------------------------------------- small writes

export async function addNote(db: D1Like, leadId: string, body: string, by = 'admin'): Promise<void> {
  const text = body.trim();
  if (!text) return;
  const row = await db.prepare(`SELECT person_id FROM leads WHERE id = ?`).bind(leadId).first<{ person_id: string | null }>();
  await logActivity(db, { leadId, personId: row?.person_id ?? '', kind: 'note', body: text, by });
  await db.prepare(`UPDATE leads SET last_activity_at = ?, updated_at = ? WHERE id = ?`).bind(new Date().toISOString(), new Date().toISOString(), leadId).run();
}

// Staff reached out: stamps the first reply time (once) so response speed can be measured.
export async function markContacted(db: D1Like, leadId: string): Promise<void> {
  const stamp = new Date().toISOString();
  await db.prepare(`UPDATE leads SET first_response_at = COALESCE(first_response_at, ?), updated_at = ? WHERE id = ?`).bind(stamp, stamp, leadId).run();
  await refreshLeadScore(db, leadId);
}

export async function setFollowUp(db: D1Like, leadId: string, dueDate: string, note: string, by = 'admin'): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return;
  const due = `${dueDate}T03:30:00.000Z`; // 09:00 India time
  const row = await db.prepare(`SELECT person_id FROM leads WHERE id = ?`).bind(leadId).first<{ person_id: string | null }>();
  await logActivity(db, { leadId, personId: row?.person_id ?? '', kind: 'task', body: note.trim() || 'Follow up', dueAt: due, by });
  await db.prepare(`UPDATE leads SET next_action_at = ?, updated_at = ? WHERE id = ?`).bind(due, new Date().toISOString(), leadId).run();
}

export async function completeFollowUp(db: D1Like, leadId: string, activityId: number): Promise<void> {
  const stamp = new Date().toISOString();
  await db.prepare(`UPDATE lead_activities SET done_at = ? WHERE id = ? AND lead_id = ? AND kind = 'task' AND done_at IS NULL`).bind(stamp, activityId, leadId).run();
  const next = await db
    .prepare(`SELECT MIN(due_at) AS d FROM lead_activities WHERE lead_id = ? AND kind = 'task' AND done_at IS NULL`)
    .bind(leadId)
    .first<{ d: string | null }>();
  await db.prepare(`UPDATE leads SET next_action_at = ?, updated_at = ? WHERE id = ?`).bind(next?.d ?? null, stamp, leadId).run();
}

// ----------------------------------------------------------------- alerting

// Tells the owner about a new lead: a Web Push and an email. Never throws.
export async function notifyNewLead(env: Record<string, any>, db: D1Like, lead: { id: string; name: string; channel: string; detail?: string }): Promise<void> {
  try {
    await sendAdminPush(env, db, { title: 'New lead', body: `${lead.name} (${lead.channel})`, url: `/admin/leads/${lead.id}`, tag: `lead-${lead.id}` });
    await sendHotelAlertEmail(env, `New lead: ${lead.name}`, [`Name: ${lead.name}`, `Channel: ${lead.channel}`, lead.detail ? `Message: ${lead.detail}` : '', `Open: https://www.iwisglobal.com/admin/leads/${lead.id}`].filter(Boolean).join('\n'), 'New lead');
  } catch (err) {
    console.error('leads: alert failed', err instanceof Error ? err.message : 'error');
  }
}

// ---------------------------------------------------------------------- CSV

// Minimal RFC 4180 reader: quoted fields, doubled quotes, commas and newlines inside quotes.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

// Spreadsheets run text starting with = + - @ as a formula; prefix those so an export is safe to open.
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const toCsv = (rows: unknown[][]): string => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

const HEADER_ALIASES: Record<string, string> = {
  name: 'name', fullname: 'name', 'full name': 'name', 'first name': 'first', firstname: 'first', 'last name': 'last', lastname: 'last',
  email: 'email', 'e-mail': 'email', 'email address': 'email',
  phone: 'phone', mobile: 'phone', whatsapp: 'phone', 'phone number': 'phone', telephone: 'phone',
  country: 'country', tour: 'tour', 'tour interest': 'tour', interest: 'tour', message: 'message', notes: 'message', note: 'message',
  source: 'source', language: 'language',
};

export interface ImportRow {
  name: string;
  email: string;
  phone: string;
  country: string;
  tour: string;
  message: string;
  source: string;
  language: string;
}

export function mapCsvRows(rows: string[][]): { rows: ImportRow[]; unknownColumns: string[] } {
  if (rows.length < 2) return { rows: [], unknownColumns: [] };
  const header = rows[0].map((h) => HEADER_ALIASES[h.trim().toLowerCase()] ?? '');
  const unknownColumns = rows[0].filter((_, i) => !header[i]).map((h) => h.trim()).filter(Boolean);
  const out: ImportRow[] = [];
  for (const r of rows.slice(1)) {
    const get = (k: string) => (header.map((h, i) => (h === k ? (r[i] ?? '').trim() : '')).find(Boolean) ?? '');
    const name = get('name') || [get('first'), get('last')].filter(Boolean).join(' ');
    out.push({ name, email: get('email'), phone: get('phone'), country: get('country'), tour: get('tour'), message: get('message'), source: get('source'), language: get('language') });
  }
  return { rows: out, unknownColumns };
}

export const IMPORT_ROW_LIMIT = 100;

// Files each row as a lead in the csv_import channel with NO marketing consent: an uploaded list
// is not evidence that anyone agreed to email marketing.
export async function importLeadRows(db: D1Like, rows: ImportRow[], batchId: string, by: string): Promise<{ imported: number; skipped: number; duplicates: number }> {
  let imported = 0;
  let skipped = 0;
  let duplicates = 0;
  for (const [index, r] of rows.slice(0, IMPORT_ROW_LIMIT).entries()) {
    if (!r.email && !r.phone) {
      skipped++;
      continue;
    }
    try {
      const res = await recordLead(db, {
        channel: 'csv_import' as Channel,
        identifiers: [
          ...(r.email ? [{ type: 'email' as const, value: r.email, source: 'csv' }] : []),
          ...(r.phone ? [{ type: 'phone' as const, value: r.phone, source: 'csv' }] : []),
        ],
        name: r.name,
        country: r.country,
        language: r.language,
        message: r.message,
        tourInterest: r.tour,
        type: 'import',
        externalRef: `import:${batchId}:${index}`,
        importBatchId: batchId,
        attribution: { source: r.source || 'csv_import' },
        createdBy: by,
      });
      if (res.duplicate) duplicates++;
      else imported++;
    } catch {
      skipped++;
    }
  }
  return { imported, skipped, duplicates };
}

export { OPEN_STAGES, canonicalStage };
