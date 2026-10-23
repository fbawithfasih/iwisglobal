import type { D1Like } from './db';
import { recordLead, recordConsent, type Attribution, type IdentifierInput } from './contacts';
import { notifyNewLead } from './leadsAdmin';
import { startDoubleOptIn } from './marketing';

// Facebook / Instagram lead ads and Instagram / Messenger direct messages -> the Leads inbox.
// Events are stored in meta_events first (schema_meta.sql), then processed; src/pages/api/meta/poll.ts
// retries what failed and fetches leads a webhook never delivered. No replies are ever sent from here.

export const META_GRAPH_VERSION = 'v25.0';
const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
export const MAX_ATTEMPTS = 8;

type FetchFn = typeof fetch;

// ------------------------------------------------------------------ parsing

export type MetaEventInput =
  | { kind: 'leadgen'; externalId: string; payload: { leadgen_id: string; page_id: string; form_id: string; ad_id: string; created_time: number | string; lead?: unknown } }
  | { kind: 'dm'; externalId: string; payload: { platform: 'instagram' | 'facebook'; sender_id: string; recipient_id: string; text: string; timestamp: number; has_attachment: boolean } };

// The webhook body for the Page and Instagram objects. Echoes (our own sent messages), delivery
// and read receipts, and messages without text or attachments are skipped.
export function parseMetaWebhook(payload: any): MetaEventInput[] {
  const out: MetaEventInput[] = [];
  const platform = payload?.object === 'instagram' ? 'instagram' : 'facebook';
  for (const entry of Array.isArray(payload?.entry) ? payload.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const v = change?.value;
      if (change?.field === 'leadgen' && v?.leadgen_id) {
        out.push({
          kind: 'leadgen',
          externalId: String(v.leadgen_id),
          payload: { leadgen_id: String(v.leadgen_id), page_id: String(v.page_id ?? entry.id ?? ''), form_id: String(v.form_id ?? ''), ad_id: String(v.ad_id ?? ''), created_time: v.created_time ?? '' },
        });
      }
    }
    for (const m of Array.isArray(entry?.messaging) ? entry.messaging : []) {
      const msg = m?.message;
      if (!msg?.mid || msg.is_echo || !m?.sender?.id) continue;
      const text = typeof msg.text === 'string' ? msg.text : '';
      const hasAttachment = Array.isArray(msg.attachments) && msg.attachments.length > 0;
      if (!text && !hasAttachment) continue;
      out.push({
        kind: 'dm',
        externalId: String(msg.mid),
        payload: {
          platform,
          sender_id: String(m.sender.id),
          recipient_id: String(m.recipient?.id ?? ''),
          text: text.slice(0, 2000),
          timestamp: Number(m.timestamp) || Date.now(),
          has_attachment: hasAttachment,
        },
      });
    }
  }
  return out;
}

// ------------------------------------------------------------- lead answers

export interface MappedLead {
  name: string;
  email: string;
  phone: string;
  city: string;
  country: string;
  tour: string;
  dates: string;
  partySize: number | null;
  // true = a consent question was answered yes, false = answered otherwise, null = no such question
  consent: boolean | null;
  answers: Record<string, string>;
}

const TRUTHY = /^(yes|true|1|i agree|agree|agreed|ok|okay|checked|accept|accepted|sure)/i;

// Maps the answers of an instant form by question key. A standard form (name, email, phone) is
// contact data, NOT marketing consent; consent is true only for an explicit consent-type question
// that was answered yes.
export function mapLeadFields(fieldData: { name?: string; values?: string[] }[] | undefined): MappedLead {
  const m: MappedLead = { name: '', email: '', phone: '', city: '', country: '', tour: '', dates: '', partySize: null, consent: null, answers: {} };
  let first = '';
  let last = '';
  for (const f of Array.isArray(fieldData) ? fieldData : []) {
    const key = String(f?.name ?? '').toLowerCase();
    const value = String((Array.isArray(f?.values) ? f.values[0] : '') ?? '').trim();
    if (!key) continue;
    m.answers[key] = value;
    if (!value) continue;
    if (key === 'full_name' || key === 'name') m.name = value;
    else if (key === 'first_name') first = value;
    else if (key === 'last_name') last = value;
    else if (key === 'email' || key === 'work_email') m.email = value;
    else if (key === 'phone_number' || key === 'phone' || key === 'work_phone_number') m.phone = value;
    else if (key === 'city') m.city = value;
    else if (key === 'country') m.country = value;
    else if (/consent|marketing|newsletter|updates|subscribe|offers/.test(key)) m.consent = TRUTHY.test(value) ? m.consent !== false : false;
    else if (/date|when/.test(key)) m.dates = value;
    else if (/tour|interest|trip|package|experience/.test(key)) m.tour = value;
    else if (/people|traveller|traveler|group|guest|adult|size/.test(key)) {
      const n = parseInt(value, 10);
      if (Number.isFinite(n) && n > 0 && n < 100) m.partySize = n;
    }
  }
  if (!m.name) m.name = [first, last].filter(Boolean).join(' ');
  return m;
}

// A guest who types their email or a +country-code number in a DM is linkable to existing records.
export function extractContacts(text: string): { email: string; phone: string } {
  const email = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.exec(text)?.[0] ?? '';
  const phone = /\+\d[\d\s().-]{8,16}\d/.exec(text)?.[0] ?? '';
  return { email, phone };
}

// ------------------------------------------------------------------ Graph

// Lead data is only returned for a PAGE access token. The configured token may be a system-user token, so
// exchange it for the Page's own token (GET /{page-id}?fields=access_token) and keep that for ten minutes.
// If the exchange fails the configured token is used as it is, so a real Page token keeps working.
let cachedPageToken: { source: string; token: string; at: number } | null = null;

async function pageToken(env: Record<string, any>, fetchFn: FetchFn): Promise<string> {
  const source = String(env.META_PAGE_ACCESS_TOKEN ?? '');
  if (!env.META_PAGE_ID || !source) return source;
  if (cachedPageToken && cachedPageToken.source === source && Date.now() - cachedPageToken.at < 10 * 60_000) return cachedPageToken.token;
  try {
    const res = await fetchFn(`${GRAPH}/${encodeURIComponent(env.META_PAGE_ID)}?fields=access_token`, { headers: { Authorization: `Bearer ${source}` } });
    if (res.ok) {
      const token = ((await res.json()) as any)?.access_token;
      if (typeof token === 'string' && token) {
        cachedPageToken = { source, token, at: Date.now() };
        return token;
      }
    }
  } catch {
    // fall back to the configured token
  }
  return source;
}

async function graphGet(env: Record<string, any>, path: string, fetchFn: FetchFn): Promise<any> {
  const res = await fetchFn(`${GRAPH}/${path}`, { headers: { Authorization: `Bearer ${await pageToken(env, fetchFn)}` } });
  if (!res.ok) {
    // Graph's error text (code and message) says why, e.g. "(#200) Requires leads_retrieval permission". It never contains the token.
    let why = '';
    try {
      const e = ((await res.json()) as any)?.error;
      if (e) why = ` (#${e.code ?? '?'}) ${String(e.message ?? '').slice(0, 160)}`;
    } catch {
      // not JSON: the status alone will do
    }
    throw new Error(`graph ${res.status}${why}`);
  }
  return res.json();
}

const LEAD_FIELDS = 'created_time,ad_id,ad_name,adset_name,campaign_id,campaign_name,form_id,is_organic,platform,field_data';

export async function fetchLeadgen(env: Record<string, any>, leadgenId: string, fetchFn: FetchFn = fetch): Promise<any> {
  try {
    return await graphGet(env, `${encodeURIComponent(leadgenId)}?fields=${LEAD_FIELDS}`, fetchFn);
  } catch {
    // Some fields need extra permissions; the basics are enough to keep the lead.
    return graphGet(env, `${encodeURIComponent(leadgenId)}?fields=created_time,ad_id,form_id,field_data`, fetchFn);
  }
}

async function fetchDmName(env: Record<string, any>, platform: string, senderId: string, fetchFn: FetchFn): Promise<string> {
  try {
    const fields = platform === 'instagram' ? 'name,username' : 'first_name,last_name';
    const p = await graphGet(env, `${encodeURIComponent(senderId)}?fields=${fields}`, fetchFn);
    return String(p.name ?? [p.first_name, p.last_name].filter(Boolean).join(' ') ?? p.username ?? '').trim();
  } catch {
    return '';
  }
}

// ------------------------------------------------------------------ storing

export interface MetaEventRow {
  id: number;
  kind: string;
  external_id: string;
  payload_json: string;
  status: string;
  attempts: number;
}

// Returns the rows that are new (a replay of the same id is ignored).
export async function storeMetaEvents(db: D1Like, events: MetaEventInput[]): Promise<MetaEventRow[]> {
  const fresh: MetaEventRow[] = [];
  const stamp = new Date().toISOString();
  for (const e of events) {
    const res = await db
      .prepare(`INSERT OR IGNORE INTO meta_events (kind, external_id, payload_json, status, attempts, created_at, updated_at) VALUES (?, ?, ?, 'pending', 0, ?, ?)`)
      .bind(e.kind, e.externalId, JSON.stringify(e.payload).slice(0, 60000), stamp, stamp)
      .run();
    if (res.meta?.changes) {
      const row = await db.prepare(`SELECT id, kind, external_id, payload_json, status, attempts FROM meta_events WHERE external_id = ?`).bind(e.externalId).first<MetaEventRow>();
      if (row) fresh.push(row);
    }
  }
  return fresh;
}

// ----------------------------------------------------------------- processing

async function processOne(env: Record<string, any>, db: D1Like, row: MetaEventRow, fetchFn: FetchFn): Promise<{ leadId: string; created: boolean; name: string; channel: string; detail: string }> {
  const p = JSON.parse(row.payload_json);
  if (row.kind === 'leadgen') {
    const lead = p.lead ?? (await fetchLeadgen(env, p.leadgen_id, fetchFn));
    const f = mapLeadFields(lead?.field_data);
    const identifiers: IdentifierInput[] = [
      ...(f.email ? [{ type: 'email' as const, value: f.email, source: 'meta_lead_ad' }] : []),
      ...(f.phone ? [{ type: 'phone' as const, value: f.phone, source: 'meta_lead_ad' }] : []),
    ];
    if (identifiers.length === 0) throw new Error('lead has no email or phone');
    const platformName = lead?.platform === 'ig' ? 'instagram' : 'facebook';
    const attribution: Attribution = {
      source: platformName,
      medium: lead?.is_organic ? 'organic_lead_form' : 'lead_ad',
      campaign: String(lead?.campaign_name ?? lead?.campaign_id ?? ''),
      adId: String(lead?.ad_id ?? p.ad_id ?? ''),
      formId: String(lead?.form_id ?? p.form_id ?? ''),
    };
    const res = await recordLead(db, {
      channel: 'fb_lead_ad',
      identifiers,
      name: f.name,
      country: f.country,
      message: [f.tour && `Tour: ${f.tour}`, f.city && `City: ${f.city}`, f.dates && `Dates: ${f.dates}`].filter(Boolean).join('\n'),
      tourInterest: f.tour,
      travelStart: f.dates,
      partySize: f.partySize,
      type: 'lead_ad',
      externalRef: String(p.leadgen_id ?? row.external_id),
      occurredAt: lead?.created_time ? new Date(lead.created_time).toISOString() : undefined,
      attribution,
      payload: { ad_name: lead?.ad_name, adset_name: lead?.adset_name, answers: f.answers },
    });
    if (f.consent === true && f.email) {
      await recordConsent(db, res.personId, {
        channel: 'email',
        action: 'granted',
        source: 'meta_lead_ad',
        formId: attribution.formId,
        textVersionId: `meta-form-${attribution.formId}`,
        evidenceRef: String(p.leadgen_id ?? row.external_id),
      });
      await startDoubleOptIn(env, db, res.personId, f.email, 'en');
    }
    return { leadId: res.leadId, created: res.createdLead, name: f.name || f.email || f.phone, channel: 'Facebook/Instagram ad', detail: f.tour };
  }

  // Direct message
  const platform = p.platform === 'instagram' ? 'instagram' : 'facebook';
  const found = extractContacts(String(p.text ?? ''));
  const name = await fetchDmName(env, platform, String(p.sender_id), fetchFn);
  const identifiers: IdentifierInput[] = [
    { type: platform === 'instagram' ? 'ig_sid' : 'fb_psid', value: String(p.sender_id), source: platform },
    ...(found.email ? [{ type: 'email' as const, value: found.email, source: 'dm_text' }] : []),
    ...(found.phone ? [{ type: 'phone' as const, value: found.phone, source: 'dm_text' }] : []),
  ];
  const res = await recordLead(db, {
    channel: platform === 'instagram' ? 'instagram_dm' : 'facebook_dm',
    identifiers,
    name: name || undefined,
    message: String(p.text ?? '') || (p.has_attachment ? '(sent a photo or file)' : ''),
    type: 'message',
    externalRef: row.external_id,
    occurredAt: new Date(Number(p.timestamp) || Date.now()).toISOString(),
    attribution: { source: platform, medium: 'direct_message' },
  });
  return { leadId: res.leadId, created: res.createdLead, name: name || `${platform} user`, channel: platform === 'instagram' ? 'Instagram DM' : 'Facebook DM', detail: String(p.text ?? '').slice(0, 200) };
}

// Processes rows one at a time; marks each done or failed (retried by the poll up to MAX_ATTEMPTS).
export async function processMetaEvents(env: Record<string, any>, db: D1Like, rows: MetaEventRow[], fetchFn: FetchFn = fetch): Promise<{ done: number; failed: number }> {
  let done = 0;
  let failed = 0;
  for (const row of rows) {
    const stamp = new Date().toISOString();
    try {
      const r = await processOne(env, db, row, fetchFn);
      await db.prepare(`UPDATE meta_events SET status = 'done', attempts = attempts + 1, error = '', lead_id = ?, updated_at = ? WHERE id = ?`).bind(r.leadId, stamp, row.id).run();
      done++;
      if (r.created) await notifyNewLead(env, db, { id: r.leadId, name: r.name, channel: r.channel, detail: r.detail });
    } catch (err) {
      failed++;
      const msg = (err instanceof Error ? err.message : 'error').slice(0, 200);
      await db.prepare(`UPDATE meta_events SET status = 'failed', attempts = attempts + 1, error = ?, updated_at = ? WHERE id = ?`).bind(msg, stamp, row.id).run();
      console.error('meta: event failed', row.kind, msg);
    }
  }
  return { done, failed };
}

// -------------------------------------------------------------------- polling

const LOOKBACK_MS = 3 * 24 * 3600_000;

// Retries failed/stuck events, then asks Meta for recent leads on every form so a lead the webhook
// never delivered is still caught (Meta deletes leads after 90 days).
export async function pollMeta(env: Record<string, any>, db: D1Like, fetchFn: FetchFn = fetch): Promise<{ retried: number; found: number; failed: number }> {
  const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
  const { results: retry } = await db
    .prepare(`SELECT id, kind, external_id, payload_json, status, attempts FROM meta_events WHERE status IN ('pending','failed') AND attempts < ? AND updated_at < ? ORDER BY id LIMIT 50`)
    .bind(MAX_ATTEMPTS, staleBefore)
    .all<MetaEventRow>();
  const retried = await processMetaEvents(env, db, retry, fetchFn);

  let fresh: MetaEventRow[] = [];
  if (env.META_PAGE_ID && env.META_PAGE_ACCESS_TOKEN) {
    const forms = await graphGet(env, `${encodeURIComponent(env.META_PAGE_ID)}/leadgen_forms?fields=id&limit=20`, fetchFn).catch(() => ({ data: [] }));
    const cutoff = Date.now() - LOOKBACK_MS;
    const events: MetaEventInput[] = [];
    for (const form of (forms.data ?? []).slice(0, 20)) {
      const leads = await graphGet(env, `${encodeURIComponent(form.id)}/leads?fields=${LEAD_FIELDS}&limit=50`, fetchFn).catch(() => ({ data: [] }));
      for (const lead of leads.data ?? []) {
        if (!lead?.id || Date.parse(lead.created_time) < cutoff) continue;
        events.push({ kind: 'leadgen', externalId: String(lead.id), payload: { leadgen_id: String(lead.id), page_id: String(env.META_PAGE_ID), form_id: String(form.id), ad_id: String(lead.ad_id ?? ''), created_time: lead.created_time, lead } });
      }
    }
    fresh = await storeMetaEvents(db, events);
  }
  const found = await processMetaEvents(env, db, fresh, fetchFn);
  return { retried: retried.done, found: found.done, failed: retried.failed + found.failed };
}

// ------------------------------------------------------------- connection test

interface GraphResult {
  ok: boolean;
  data?: any;
  error?: string;
}

async function graphTry(token: string, path: string, fetchFn: FetchFn): Promise<GraphResult> {
  try {
    const res = await fetchFn(`${GRAPH}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: `(#${body?.error?.code ?? res.status}) ${String(body?.error?.message ?? 'error').slice(0, 200)}` };
    return { ok: true, data: body };
  } catch {
    return { ok: false, error: 'network error' };
  }
}

// Plain-language lines for the admin page: what the saved token is, what it may do, and whether a lead can be read.
// Never returns a token.
export async function diagnoseMeta(env: Record<string, any>, db: D1Like, fetchFn: FetchFn = fetch): Promise<string[]> {
  const out: string[] = [];
  const token = String(env.META_PAGE_ACCESS_TOKEN ?? '');
  const pageId = String(env.META_PAGE_ID ?? '');
  if (!token) return ['META_PAGE_ACCESS_TOKEN is not set.'];
  if (!pageId) out.push('META_PAGE_ID is not set.');
  out.push(`Page id saved on the site: ${pageId || '(none)'} (the Page in Meta's test event was 100724031348473 if you used the test tool).`);

  const me = await graphTry(token, 'me?fields=id,name', fetchFn);
  out.push(me.ok ? `The saved token belongs to: ${me.data?.name ?? '?'} (id ${me.data?.id ?? '?'}). A Page name here means it is a Page token; a system user or person means it is not.` : `The saved token was refused: ${me.error}`);

  const perms = await graphTry(token, 'me/permissions', fetchFn);
  if (perms.ok) {
    const granted = (perms.data?.data ?? []).filter((p: any) => p.status === 'granted').map((p: any) => p.permission);
    out.push(`Permissions on the saved token: ${granted.join(', ') || '(none listed)'}. leads_retrieval ${granted.includes('leads_retrieval') ? 'is' : 'is NOT'} among them.`);
  } else out.push(`Permissions could not be listed: ${perms.error}`);

  // The Pages this token's user can really act on, and with which tasks. The Page that received the lead must be listed.
  for (const edge of ['me/assigned_pages', 'me/accounts']) {
    const pages = await graphTry(token, `${edge}?fields=id,name,tasks&limit=25`, fetchFn);
    if (pages.ok) {
      const list = (pages.data?.data ?? []).map((p: any) => `${p.name ?? '?'} (id ${p.id}${Array.isArray(p.tasks) && p.tasks.length ? `; tasks: ${p.tasks.join(', ')}` : ''})`);
      out.push(`Pages visible to the saved token via ${edge}: ${list.length ? list.join(' | ') : 'none'}.${pageId && !list.some((l: string) => l.includes(`id ${pageId}`)) && list.length ? ` The saved Page id ${pageId} is NOT among them.` : ''}`);
      if (list.length) break;
    } else out.push(`${edge} failed: ${pages.error}`);
  }

  let useToken = token;
  if (pageId) {
    const page = await graphTry(token, `${encodeURIComponent(pageId)}?fields=id,name,access_token`, fetchFn);
    if (page.ok) {
      out.push(`Page lookup works: ${page.data?.name ?? '?'}.`);
      if (page.data?.access_token) {
        useToken = page.data.access_token;
        out.push('A Page access token was obtained from the saved token: yes.');
      } else out.push('A Page access token was obtained from the saved token: NO (the saved token has no access to this Page\'s own token).');
    } else out.push(`Page lookup failed: ${page.error}`);

    const forms = await graphTry(useToken, `${encodeURIComponent(pageId)}/leadgen_forms?fields=id,name&limit=5`, fetchFn);
    out.push(forms.ok ? `Lead forms readable: ${(forms.data?.data ?? []).length} found.` : `Lead forms NOT readable: ${forms.error}`);
  }

  const last = await db
    .prepare(`SELECT external_id FROM meta_events WHERE kind = 'leadgen' ORDER BY id DESC LIMIT 1`)
    .bind()
    .first<{ external_id: string }>()
    .catch(() => null);
  if (last?.external_id) {
    const lead = await graphTry(useToken, `${encodeURIComponent(last.external_id)}?fields=id,created_time,field_data`, fetchFn);
    out.push(lead.ok ? `Latest lead (${last.external_id}) can be read: yes.` : `Latest lead (${last.external_id}) cannot be read: ${lead.error}`);
    if (!lead.ok && useToken !== token) {
      const alt = await graphTry(token, `${encodeURIComponent(last.external_id)}?fields=id,created_time,field_data`, fetchFn);
      out.push(alt.ok ? 'The same lead CAN be read with the saved token directly.' : `With the saved token directly: ${alt.error}`);
    }
  } else out.push('No lead event received yet to test with.');
  return out;
}
