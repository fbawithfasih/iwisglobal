// Unified contacts and lead management (schema_contacts.sql). Every way a person can reach us
// (website form, WhatsApp, a booking, a quote, a Meta lead ad, a call, a CSV row) goes through
// this file and nothing else, so one person is one row however they arrive:
//
//   people              one row per real person
//   person_identifiers  their emails, phones, WhatsApp ids, Instagram/Messenger ids (normalised)
//   leads               an enquiry or trip intent for a person (the old `leads` table, extended)
//   touchpoints         an append-only history of every contact, with where it came from
//   lead_activities     notes, tasks, stage changes
//   consent_events      the consent ledger; suppressions are permanent
//
// Rules the rest of the code relies on:
//   - Matching is deterministic and exact on normalised identifiers. Two different people
//     matching one enquiry never merge by themselves: a duplicate suggestion is recorded and a
//     human decides. A name is never a key.
//   - Recording is idempotent when given an externalRef (a webhook can be replayed any number of
//     times and creates nothing new).
//   - Nothing here sends a message or changes a booking; it only records.
import type { D1Like } from './db';

// ---------------------------------------------------------------- vocabulary

export const LEAD_STAGES = ['new', 'contacted', 'qualified', 'quote_sent', 'deposit_paid', 'booked', 'lost', 'spam'] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];
// Order of the sales ladder. lost and spam sit outside it.
const STAGE_RANK: Record<string, number> = { new: 0, contacted: 1, qualified: 2, quote_sent: 3, deposit_paid: 4, booked: 5 };
export const OPEN_STAGES: LeadStage[] = ['new', 'contacted', 'qualified', 'quote_sent', 'deposit_paid'];
export const LOST_REASONS = ['price', 'chose_competitor', 'dates_unavailable', 'just_researching', 'no_reply', 'changed_plans', 'wrong_fit', 'other'] as const;

export const CHANNELS = [
  'website', 'whatsapp', 'fb_lead_ad', 'instagram_dm', 'facebook_dm', 'email', 'phone', 'manual',
  'csv_import', 'booking', 'custom_trip', 'offer', 'hotel', 'marketplace', 'google_ads',
] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABELS: Record<string, string> = {
  website: 'Website', whatsapp: 'WhatsApp', fb_lead_ad: 'Facebook/Instagram ad', instagram_dm: 'Instagram DM', facebook_dm: 'Facebook DM',
  email: 'Email', phone: 'Phone', manual: 'Added by hand', csv_import: 'CSV import', booking: 'Booking', custom_trip: 'Custom trip',
  offer: 'Private offer', hotel: 'Hotel', marketplace: 'Marketplace', google_ads: 'Google ad',
};

export type IdentifierType = 'email' | 'phone' | 'wa_id' | 'ig_sid' | 'fb_psid' | 'ig_username';

export interface IdentifierInput {
  type: IdentifierType;
  value: string;
  // An agent's or a family's address or number: stored, never used to match.
  shared?: boolean;
  source?: string;
}

export interface Attribution {
  source?: string;
  medium?: string;
  campaign?: string;
  adId?: string;
  formId?: string;
  ctwaClid?: string;
  fbclid?: string;
  gclid?: string;
  utmContent?: string;
  utmTerm?: string;
  referrer?: string;
  landingPage?: string;
  refTag?: string;
}

const nowIso = () => new Date().toISOString();
const newId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const changed = (res: unknown): boolean => ((res as any)?.meta?.changes ?? 0) > 0;

// ------------------------------------------------------------- normalisation

// The match key for an email: trimmed and lowercased. Gmail ignores dots and "+tags" in the
// part before the @, and googlemail.com is gmail.com, so those collapse; other providers keep
// their dots. The address we store and send to is never rewritten, only this key.
export function normaliseEmail(raw: string): string | null {
  const s = String(raw ?? '').normalize('NFKC').trim().toLowerCase().replace(/\.+$/, '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) || s.length > 254) return null;
  let [local, domain] = s.split('@');
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.split('+')[0].replace(/\./g, '');
  return local ? `${local}@${domain}` : null;
}

// A phone number as E.164 (+ and 8 to 15 digits), or null when it cannot be told for sure.
// Numbers with a + or 00 prefix, and WhatsApp ids (digits that already start with the country
// code), are taken as they are. A bare Indian national number becomes +91. Anything else is
// rejected rather than guessed.
export function normalisePhone(raw: string, opts: { hasCountryCode?: boolean } = {}): string | null {
  const s = String(raw ?? '').trim();
  let d = s.replace(/\D/g, '');
  if (!d) return null;
  const explicit = s.startsWith('+') || s.startsWith('00');
  if (s.startsWith('00')) d = d.replace(/^00/, '');
  if (explicit || opts.hasCountryCode) return /^[1-9]\d{7,14}$/.test(d) ? `+${d}` : null;
  if (/^[6-9]\d{9}$/.test(d)) return `+91${d}`;
  if (/^0[6-9]\d{9}$/.test(d)) return `+91${d.slice(1)}`;
  if (/^91[6-9]\d{9}$/.test(d)) return `+${d}`;
  return null;
}

// [normalised key, stored type] for an identifier, or null when it is unusable.
export function normaliseIdentifier(type: IdentifierType, value: string): string | null {
  const v = String(value ?? '').trim();
  if (!v) return null;
  switch (type) {
    case 'email':
      return normaliseEmail(v);
    case 'phone':
      return normalisePhone(v);
    case 'wa_id': {
      const p = normalisePhone(v, { hasCountryCode: true });
      return p ? p.slice(1) : null; // digits only, as WhatsApp sends them
    }
    case 'ig_username':
      return v.replace(/^@/, '').toLowerCase();
    default:
      return v; // ig_sid and fb_psid are opaque ids
  }
}

export function splitName(full: string): { first: string; last: string } {
  const parts = String(full ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

export async function hashIdentifier(norm: string): Promise<string> {
  const bytes = new TextEncoder().encode(norm);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ------------------------------------------------------------------- people

interface Resolved {
  type: IdentifierType;
  raw: string;
  norm: string;
  shared: boolean;
  source: string;
}

// A WhatsApp id is also a phone number, so it becomes both identifiers and a later web form with
// the same number lands on the same person.
function resolveIdentifiers(list: IdentifierInput[]): Resolved[] {
  const out: Resolved[] = [];
  const seen = new Set<string>();
  const push = (type: IdentifierType, raw: string, norm: string | null, shared: boolean, source: string) => {
    if (!norm) return;
    const k = `${type}|${norm}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ type, raw, norm, shared, source });
  };
  for (const i of list) {
    const shared = !!i.shared;
    const source = i.source ?? '';
    push(i.type, String(i.value).trim(), normaliseIdentifier(i.type, i.value), shared, source);
    if (i.type === 'wa_id') push('phone', `+${normaliseIdentifier('wa_id', i.value) ?? ''}`, normaliseIdentifier('phone', `+${String(i.value).replace(/\D/g, '')}`), shared, source);
  }
  return out;
}

// Strongest first. A username can change, so it is only a last resort.
const MATCH_ORDER: IdentifierType[] = ['wa_id', 'ig_sid', 'fb_psid', 'phone', 'email', 'ig_username'];

// Follows merged_into_id to the surviving person.
export async function rootPerson(db: D1Like, id: string): Promise<string> {
  let cur = id;
  for (let hop = 0; hop < 6; hop++) {
    const row = await db.prepare(`SELECT merged_into_id FROM people WHERE id = ?`).bind(cur).first<{ merged_into_id: string | null }>();
    if (!row?.merged_into_id) return cur;
    cur = row.merged_into_id;
  }
  return cur;
}

async function suggestDuplicate(db: D1Like, a: string, b: string, reason: string): Promise<void> {
  if (a === b) return;
  const [x, y] = a < b ? [a, b] : [b, a];
  await db
    .prepare(`INSERT OR IGNORE INTO duplicate_suggestions (person_a, person_b, reason, status, created_at) VALUES (?, ?, ?, 'open', ?)`)
    .bind(x, y, reason, nowIso())
    .run();
}

export interface PersonProfile {
  name?: string;
  country?: string;
  language?: string;
}

export interface UpsertResult {
  personId: string;
  created: boolean;
  // Other people that also matched, now listed as possible duplicates.
  duplicates: string[];
}

// Finds the person these identifiers belong to, or creates one. Never merges two people.
export async function upsertPerson(db: D1Like, identifiers: IdentifierInput[], profile: PersonProfile = {}): Promise<UpsertResult> {
  const ids = resolveIdentifiers(identifiers);
  const stamp = nowIso();

  const matches: { personId: string; via: IdentifierType }[] = [];
  for (const type of MATCH_ORDER) {
    for (const i of ids.filter((x) => x.type === type && !x.shared)) {
      const row = await db
        .prepare(`SELECT person_id FROM person_identifiers WHERE type = ? AND value_norm = ? AND is_shared = 0 LIMIT 1`)
        .bind(i.type, i.norm)
        .first<{ person_id: string }>();
      if (row) matches.push({ personId: await rootPerson(db, row.person_id), via: i.type });
    }
  }
  const distinct = [...new Set(matches.map((m) => m.personId))];

  let personId: string;
  let created = false;
  if (distinct.length === 0) {
    personId = newId('per');
    created = true;
    const name = (profile.name ?? '').trim();
    const { first, last } = splitName(name);
    await db
      .prepare(
        `INSERT INTO people (id, display_name, first_name, last_name, country, language, marketing_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'none', ?, ?)`
      )
      .bind(personId, name, first, last, profile.country ?? '', profile.language ?? '', stamp, stamp)
      .run();
  } else {
    personId = distinct[0];
  }

  const duplicates: string[] = [];
  for (const other of distinct.slice(1)) {
    await suggestDuplicate(db, personId, other, 'One enquiry matched two different people');
    duplicates.push(other);
  }

  for (const i of ids) {
    const inserted = await db
      .prepare(
        `INSERT OR IGNORE INTO person_identifiers (person_id, type, value_raw, value_norm, is_shared, source, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(personId, i.type, i.raw, i.norm, i.shared ? 1 : 0, i.source, stamp, stamp)
      .run();
    if (!changed(inserted)) {
      // Already stored. Refresh when it is ours, otherwise another person owns it.
      const owner = await db
        .prepare(`SELECT id, person_id FROM person_identifiers WHERE type = ? AND value_norm = ? AND is_shared = ? LIMIT 1`)
        .bind(i.type, i.norm, i.shared ? 1 : 0)
        .first<{ id: number; person_id: string }>();
      if (owner) {
        const ownerRoot = await rootPerson(db, owner.person_id);
        if (ownerRoot === personId) {
          await db.prepare(`UPDATE person_identifiers SET last_seen_at = ? WHERE id = ?`).bind(stamp, owner.id).run();
        } else if (!i.shared) {
          await suggestDuplicate(db, personId, ownerRoot, `Shares ${i.type} ${i.raw}`);
          if (!duplicates.includes(ownerRoot)) duplicates.push(ownerRoot);
        }
      }
    }
  }

  if (!created) await fillProfile(db, personId, profile);
  return { personId, created, duplicates };
}

// Only fills what is empty, so a later enquiry never overwrites what we already know.
async function fillProfile(db: D1Like, personId: string, profile: PersonProfile): Promise<void> {
  const name = (profile.name ?? '').trim();
  const { first, last } = splitName(name);
  await db
    .prepare(
      `UPDATE people SET
         display_name = CASE WHEN display_name = '' THEN ? ELSE display_name END,
         first_name = CASE WHEN first_name = '' THEN ? ELSE first_name END,
         last_name = CASE WHEN last_name = '' THEN ? ELSE last_name END,
         country = CASE WHEN country = '' THEN ? ELSE country END,
         language = CASE WHEN language = '' THEN ? ELSE language END,
         updated_at = ?
       WHERE id = ?`
    )
    .bind(name, first, last, profile.country ?? '', profile.language ?? '', nowIso(), personId)
    .run();
}

// ------------------------------------------------------------------- leads

export interface LeadInput {
  channel: Channel;
  identifiers: IdentifierInput[];
  name?: string;
  country?: string;
  language?: string;
  message?: string;
  tourInterest?: string;
  travelStart?: string;
  partySize?: number | null;
  // What kind of contact this was: form, message, lead_ad, call, booking, quote, import ...
  type?: string;
  attribution?: Attribution;
  // A stable id from the source (Meta lead id, WhatsApp message id, booking id, form submission
  // id). With it, recording the same thing twice creates nothing the second time.
  externalRef?: string;
  occurredAt?: string;
  payload?: unknown;
  importBatchId?: string;
  // Starting stage for a lead this call creates. Defaults to 'new'.
  stage?: LeadStage;
  createdBy?: string;
  // An open lead for the same person newer than this is reused instead of opening another.
  reuseWindowDays?: number;
}

export interface LeadResult {
  leadId: string;
  personId: string;
  createdPerson: boolean;
  createdLead: boolean;
  // This exact contact was already recorded (a replayed webhook).
  duplicate: boolean;
}

const DEFAULT_REUSE_DAYS = 30;

async function insertTouchpoint(
  db: D1Like,
  t: { personId: string; leadId: string | null; input: LeadInput; occurredAt: string }
): Promise<boolean> {
  const a = t.input.attribution ?? {};
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO touchpoints (person_id, lead_id, occurred_at, channel, type, source, medium, campaign, ad_id, form_id, ctwa_clid, fbclid, gclid,
         utm_content, utm_term, referrer, landing_page, ref_tag, external_ref, import_batch_id, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      t.personId, t.leadId, t.occurredAt, t.input.channel, t.input.type ?? '', a.source ?? '', a.medium ?? '', a.campaign ?? '', a.adId ?? '', a.formId ?? '',
      a.ctwaClid ?? '', a.fbclid ?? '', a.gclid ?? '', a.utmContent ?? '', a.utmTerm ?? '', a.referrer ?? '', a.landingPage ?? '', a.refTag ?? '',
      t.input.externalRef ?? null, t.input.importBatchId ?? '', t.input.payload === undefined ? '' : JSON.stringify(t.input.payload).slice(0, 20000)
    )
    .run();
  return changed(res);
}

// A touchpoint with no lead: for things that are a contact but not an enquiry (a newsletter signup), so
// the person's history is complete without opening a lead in the inbox.
export async function recordTouchpoint(
  db: D1Like,
  t: { personId: string; channel: Channel; type: string; attribution?: Attribution; externalRef?: string; occurredAt?: string }
): Promise<boolean> {
  return insertTouchpoint(db, {
    personId: t.personId,
    leadId: null,
    input: { channel: t.channel, identifiers: [], type: t.type, attribution: t.attribution, externalRef: t.externalRef },
    occurredAt: t.occurredAt ?? nowIso(),
  });
}

export async function logActivity(
  db: D1Like,
  a: { leadId: string; personId?: string; kind: 'note' | 'call' | 'task' | 'stage' | 'system' | 'email'; body: string; dueAt?: string | null; by?: string }
): Promise<void> {
  await db
    .prepare(`INSERT INTO lead_activities (lead_id, person_id, kind, body, due_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(a.leadId, a.personId ?? '', a.kind, a.body.slice(0, 4000), a.dueAt ?? null, a.by ?? '', nowIso())
    .run();
}

// The one entry point every channel calls. Finds or creates the person, writes the touchpoint,
// and attaches it to the person's open lead (or opens one).
export async function recordLead(db: D1Like, input: LeadInput): Promise<LeadResult> {
  const occurredAt = input.occurredAt ?? nowIso();

  // A replay of something already recorded does nothing. A half-finished earlier attempt (the
  // touchpoint exists but no lead was attached) is completed instead.
  let claimed = false;
  if (input.externalRef) {
    const prior = await db
      .prepare(`SELECT person_id, lead_id FROM touchpoints WHERE channel = ? AND external_ref = ?`)
      .bind(input.channel, input.externalRef)
      .first<{ person_id: string; lead_id: string | null }>();
    if (prior?.lead_id) {
      return { leadId: prior.lead_id, personId: await rootPerson(db, prior.person_id), createdPerson: false, createdLead: false, duplicate: true };
    }
    claimed = !!prior;
  }

  const up = await upsertPerson(db, input.identifiers, { name: input.name, country: input.country, language: input.language });

  if (input.externalRef && !claimed) {
    const first = await insertTouchpoint(db, { personId: up.personId, leadId: null, input, occurredAt });
    if (!first) {
      // Lost a race with a concurrent delivery of the same thing: that one finishes it.
      const prior = await db
        .prepare(`SELECT lead_id FROM touchpoints WHERE channel = ? AND external_ref = ?`)
        .bind(input.channel, input.externalRef)
        .first<{ lead_id: string | null }>();
      if (prior?.lead_id) return { leadId: prior.lead_id, personId: up.personId, createdPerson: up.created, createdLead: false, duplicate: true };
    }
  }

  const cutoff = new Date(Date.parse(occurredAt) - (input.reuseWindowDays ?? DEFAULT_REUSE_DAYS) * 86_400_000).toISOString();
  const open = await db
    .prepare(
      `SELECT id FROM leads WHERE person_id = ? AND status IN ('new','contacted','qualified','quote_sent','deposit_paid')
         AND COALESCE(last_activity_at, created_at) >= ? ORDER BY created_at DESC LIMIT 1`
    )
    .bind(up.personId, cutoff)
    .first<{ id: string }>();

  const email = input.identifiers.find((i) => i.type === 'email' && normaliseEmail(i.value))?.value.trim() ?? '';
  const phoneIdent = input.identifiers.find((i) => (i.type === 'phone' || i.type === 'wa_id') && normaliseIdentifier(i.type, i.value));
  const phone = phoneIdent ? (phoneIdent.type === 'wa_id' ? `+${normaliseIdentifier('wa_id', phoneIdent.value)}` : phoneIdent.value.trim()) : '';
  const a = input.attribution ?? {};
  const stamp = nowIso();

  let leadId: string;
  let createdLead = false;
  if (open) {
    leadId = open.id;
    await db
      .prepare(
        `UPDATE leads SET last_activity_at = ?, updated_at = ?,
           email = CASE WHEN email = '' THEN ? ELSE email END,
           phone = CASE WHEN phone = '' THEN ? ELSE phone END,
           tour_interest = CASE WHEN tour_interest = '' THEN ? ELSE tour_interest END,
           travel_start = CASE WHEN travel_start = '' THEN ? ELSE travel_start END,
           party_size = COALESCE(party_size, ?),
           country = CASE WHEN country = '' THEN ? ELSE country END,
           language = CASE WHEN language = '' THEN ? ELSE language END
         WHERE id = ?`
      )
      .bind(occurredAt, stamp, email, phone, input.tourInterest ?? '', input.travelStart ?? '', input.partySize ?? null, input.country ?? '', input.language ?? '', leadId)
      .run();
  } else {
    leadId = newId('lead');
    createdLead = true;
    const display = (input.name ?? '').trim() || (await personName(db, up.personId)) || email || phone || '(unknown)';
    await db
      .prepare(
        `INSERT INTO leads (id, name, email, phone, message, tour_interest, status, created_at, person_id, channel, campaign, travel_start, party_size,
           language, country, last_activity_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        leadId, display, email, phone, (input.message ?? '').slice(0, 4000), input.tourInterest ?? '', input.stage ?? 'new', occurredAt, up.personId, input.channel,
        a.campaign ?? '', input.travelStart ?? '', input.partySize ?? null, input.language ?? '', input.country ?? '', occurredAt, stamp
      )
      .run();
  }

  if (input.externalRef) {
    await db.prepare(`UPDATE touchpoints SET lead_id = ? WHERE channel = ? AND external_ref = ? AND lead_id IS NULL`).bind(leadId, input.channel, input.externalRef).run();
  } else {
    await insertTouchpoint(db, { personId: up.personId, leadId, input, occurredAt });
  }

  const label = CHANNEL_LABELS[input.channel] ?? input.channel;
  const text = (input.message ?? '').trim();
  await logActivity(db, {
    leadId,
    personId: up.personId,
    kind: 'system',
    body: createdLead ? `Enquiry via ${label}${text ? `: ${text.slice(0, 300)}` : ''}` : `Contact via ${label}${text ? `: ${text.slice(0, 300)}` : ''}`,
    by: input.createdBy ?? '',
  });
  return { leadId, personId: up.personId, createdPerson: up.created, createdLead, duplicate: false };
}

async function personName(db: D1Like, personId: string): Promise<string> {
  const row = await db.prepare(`SELECT display_name FROM people WHERE id = ?`).bind(personId).first<{ display_name: string }>();
  return row?.display_name ?? '';
}

export const canonicalStage = (status: string): string => (status === 'converted' ? 'booked' : status);

// Moves a lead FORWARD along new, contacted, qualified, quote_sent, deposit_paid, booked. It never
// moves one back and never touches a lead that is lost or spam; staff do that with setLeadStage.
export async function advanceLead(db: D1Like, leadId: string, stage: LeadStage, opts: { by?: string; note?: string; bookingId?: string | null } = {}): Promise<boolean> {
  const lead = await db.prepare(`SELECT status, first_response_at, person_id FROM leads WHERE id = ?`).bind(leadId).first<{ status: string; first_response_at: string | null; person_id: string | null }>();
  if (!lead) return false;
  const from = canonicalStage(lead.status);
  const fromRank = STAGE_RANK[from];
  const toRank = STAGE_RANK[stage];
  if (fromRank === undefined || toRank === undefined || toRank <= fromRank) {
    if (opts.bookingId) await db.prepare(`UPDATE leads SET booking_id = COALESCE(booking_id, ?), updated_at = ? WHERE id = ?`).bind(opts.bookingId, nowIso(), leadId).run();
    return false;
  }
  const stamp = nowIso();
  await db
    .prepare(
      `UPDATE leads SET status = ?, updated_at = ?, last_activity_at = ?, booking_id = COALESCE(?, booking_id),
         first_response_at = CASE WHEN ? AND first_response_at IS NULL THEN ? ELSE first_response_at END
       WHERE id = ?`
    )
    .bind(stage, stamp, stamp, opts.bookingId ?? null, stage === 'contacted' || stage === 'qualified' ? 1 : 0, stamp, leadId)
    .run();
  await logActivity(db, { leadId, personId: lead.person_id ?? '', kind: 'stage', body: `${from} to ${stage}${opts.note ? `: ${opts.note}` : ''}`, by: opts.by ?? '' });
  return true;
}

// Staff change: any stage to any stage, with a reason when it is lost.
export async function setLeadStage(db: D1Like, leadId: string, stage: LeadStage, opts: { by?: string; lostReason?: string } = {}): Promise<boolean> {
  if (!(LEAD_STAGES as readonly string[]).includes(stage)) throw new Error('Invalid stage');
  const lead = await db.prepare(`SELECT status, person_id FROM leads WHERE id = ?`).bind(leadId).first<{ status: string; person_id: string | null }>();
  if (!lead) return false;
  const from = canonicalStage(lead.status);
  if (from === stage) return false;
  const stamp = nowIso();
  await db
    .prepare(
      `UPDATE leads SET status = ?, lost_reason = ?, updated_at = ?, last_activity_at = ?,
         first_response_at = CASE WHEN ? AND first_response_at IS NULL THEN ? ELSE first_response_at END
       WHERE id = ?`
    )
    .bind(stage, stage === 'lost' ? opts.lostReason ?? 'other' : '', stamp, stamp, stage === 'contacted' || stage === 'qualified' || stage === 'quote_sent' ? 1 : 0, stamp, leadId)
    .run();
  await logActivity(db, { leadId, personId: lead.person_id ?? '', kind: 'stage', body: `${from} to ${stage}${stage === 'lost' && opts.lostReason ? ` (${opts.lostReason})` : ''}`, by: opts.by ?? '' });
  return true;
}

// A paid booking, an accepted quote and similar events: make sure the person has a lead and move
// it forward. Used by the payment code, so it must never throw into a payment flow.
export async function trackLeadEvent(
  db: D1Like,
  e: {
    channel: Channel;
    identifiers: IdentifierInput[];
    name?: string;
    language?: string;
    country?: string;
    externalRef: string;
    stage: LeadStage;
    tourInterest?: string;
    travelStart?: string;
    partySize?: number | null;
    message?: string;
    bookingId?: string | null;
    note?: string;
    attribution?: Attribution;
  }
): Promise<LeadResult | null> {
  try {
    const r = await recordLead(db, {
      channel: e.channel,
      identifiers: e.identifiers,
      name: e.name,
      language: e.language,
      country: e.country,
      externalRef: e.externalRef,
      tourInterest: e.tourInterest,
      travelStart: e.travelStart,
      partySize: e.partySize,
      message: e.message,
      type: e.channel,
      stage: e.stage,
      attribution: e.attribution,
    });
    await advanceLead(db, r.leadId, e.stage, { bookingId: e.bookingId, note: e.note });
    await refreshLeadScore(db, r.leadId);
    return r;
  } catch (err) {
    // The tables may not exist yet, or D1 may hiccup: never break a payment or a webhook over this.
    console.error('contacts: lead tracking failed', err instanceof Error ? err.message : 'error');
    return null;
  }
}

// ------------------------------------------------------------------ scoring

export interface ScoreInput {
  channel: string;
  hasDates: boolean;
  hasPartySize: boolean;
  hasTour: boolean;
  hasPhone: boolean;
  hasEmail: boolean;
  firstResponseMinutes: number | null;
  stage: string;
}

// A short, readable points score, not a model. Revisit once there are a few hundred won and lost
// leads to learn from.
export function computeLeadScore(i: ScoreInput): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const add = (points: number, why: string) => {
    score += points;
    reasons.push(`${points > 0 ? '+' : ''}${points} ${why}`);
  };
  if (i.hasDates) add(15, 'travel dates given');
  if (i.hasPartySize) add(10, 'group size given');
  if (i.hasTour) add(10, 'tour named');
  if (i.hasPhone) add(10, 'phone or WhatsApp number');
  if (i.hasEmail && !i.hasPhone) add(5, 'email only');
  if (i.firstResponseMinutes !== null && i.firstResponseMinutes <= 60) add(10, 'answered within an hour');
  const rank = STAGE_RANK[canonicalStage(i.stage)];
  if (rank !== undefined && rank >= STAGE_RANK.quote_sent) add(15, 'quote or offer sent');
  if (['website', 'whatsapp', 'custom_trip', 'offer', 'booking'].includes(i.channel)) add(10, 'asked us directly');
  if (i.stage === 'spam') add(-50, 'marked spam');
  return { score, reasons };
}

export const scoreBucket = (score: number): 'hot' | 'warm' | 'cold' => (score >= 60 ? 'hot' : score >= 30 ? 'warm' : 'cold');

export async function refreshLeadScore(db: D1Like, leadId: string): Promise<void> {
  const l = await db
    .prepare(`SELECT channel, travel_start, party_size, tour_interest, phone, email, status, created_at, first_response_at FROM leads WHERE id = ?`)
    .bind(leadId)
    .first<{ channel: string; travel_start: string; party_size: number | null; tour_interest: string; phone: string; email: string; status: string; created_at: string; first_response_at: string | null }>();
  if (!l) return;
  const minutes = l.first_response_at ? Math.max(0, (Date.parse(l.first_response_at) - Date.parse(l.created_at)) / 60_000) : null;
  const { score, reasons } = computeLeadScore({
    channel: l.channel, hasDates: !!l.travel_start, hasPartySize: !!l.party_size, hasTour: !!l.tour_interest, hasPhone: !!l.phone, hasEmail: !!l.email,
    firstResponseMinutes: minutes, stage: l.status,
  });
  await db.prepare(`UPDATE leads SET score = ?, score_reason = ? WHERE id = ?`).bind(score, reasons.join('; '), leadId).run();
}

// ------------------------------------------------------------------- merging

interface MergeSnapshot {
  identifierIds: number[];
  leadIds: string[];
  touchpointIds: number[];
  activityIds: number[];
  consentIds: number[];
  tags: { tag: string; created_at: string }[];
}

const pluckIds = <I extends number | string>(rows: { id: I }[]): I[] => rows.map((r) => r.id);

// Joins two people into one. Everything the dropped person owns moves to the kept one; the
// dropped row stays, pointing at the survivor. The merge log lets undoMerge reverse it.
export async function mergePeople(db: D1Like, keepId: string, dropId: string, by = ''): Promise<{ ok: true; logId: number } | { ok: false; error: string }> {
  const keep = await rootPerson(db, keepId);
  const drop = await rootPerson(db, dropId);
  if (keep === drop) return { ok: false, error: 'These are already the same person.' };
  const both = await db.prepare(`SELECT id FROM people WHERE id IN (?, ?)`).bind(keep, drop).all<{ id: string }>();
  if (both.results.length !== 2) return { ok: false, error: 'Person not found.' };

  const q = async <T>(sql: string) => (await db.prepare(sql).bind(drop).all<T>()).results;
  const snapshot: MergeSnapshot = {
    identifierIds: pluckIds(await q<{ id: number }>(`SELECT id FROM person_identifiers WHERE person_id = ?`)),
    leadIds: pluckIds(await q<{ id: string }>(`SELECT id FROM leads WHERE person_id = ?`)),
    touchpointIds: pluckIds(await q<{ id: number }>(`SELECT id FROM touchpoints WHERE person_id = ?`)),
    activityIds: pluckIds(await q<{ id: number }>(`SELECT id FROM lead_activities WHERE person_id = ?`)),
    consentIds: pluckIds(await q<{ id: number }>(`SELECT id FROM consent_events WHERE person_id = ?`)),
    tags: await q<{ tag: string; created_at: string }>(`SELECT tag, created_at FROM person_tags WHERE person_id = ?`),
  };
  const stamp = nowIso();
  await db
    .prepare(`INSERT INTO merge_log (kept_id, dropped_id, snapshot_json, merged_by, merged_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(keep, drop, JSON.stringify(snapshot), by, stamp)
    .run();
  const log = await db.prepare(`SELECT MAX(id) AS id FROM merge_log WHERE kept_id = ? AND dropped_id = ?`).bind(keep, drop).first<{ id: number }>();

  for (const table of ['person_identifiers', 'leads', 'touchpoints', 'lead_activities', 'consent_events']) {
    await db.prepare(`UPDATE ${table} SET person_id = ? WHERE person_id = ?`).bind(keep, drop).run();
  }
  await db.prepare(`INSERT OR IGNORE INTO person_tags (person_id, tag, created_at) SELECT ?, tag, created_at FROM person_tags WHERE person_id = ?`).bind(keep, drop).run();
  await db.prepare(`DELETE FROM person_tags WHERE person_id = ?`).bind(drop).run();

  const d = await db.prepare(`SELECT display_name, country, language FROM people WHERE id = ?`).bind(drop).first<{ display_name: string; country: string; language: string }>();
  if (d) await fillProfile(db, keep, { name: d.display_name, country: d.country, language: d.language });
  await db.prepare(`UPDATE people SET merged_into_id = ?, updated_at = ? WHERE id = ?`).bind(keep, stamp, drop).run();
  const [a, b] = keep < drop ? [keep, drop] : [drop, keep];
  await db.prepare(`UPDATE duplicate_suggestions SET status = 'merged' WHERE person_a = ? AND person_b = ?`).bind(a, b).run();
  await refreshMarketingStatus(db, keep);
  return { ok: true, logId: log?.id ?? 0 };
}

export async function undoMerge(db: D1Like, logId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const log = await db.prepare(`SELECT * FROM merge_log WHERE id = ?`).bind(logId).first<{ kept_id: string; dropped_id: string; snapshot_json: string; undone_at: string | null }>();
  if (!log) return { ok: false, error: 'Merge not found.' };
  if (log.undone_at) return { ok: false, error: 'This merge was already undone.' };
  const s = JSON.parse(log.snapshot_json) as MergeSnapshot;
  const move = async (table: string, key: 'id', list: (number | string)[]) => {
    for (const id of list) await db.prepare(`UPDATE ${table} SET person_id = ? WHERE ${key} = ? AND person_id = ?`).bind(log.dropped_id, id, log.kept_id).run();
  };
  await move('person_identifiers', 'id', s.identifierIds);
  await move('leads', 'id', s.leadIds);
  await move('touchpoints', 'id', s.touchpointIds);
  await move('lead_activities', 'id', s.activityIds);
  await move('consent_events', 'id', s.consentIds);
  for (const t of s.tags) await db.prepare(`INSERT OR IGNORE INTO person_tags (person_id, tag, created_at) VALUES (?, ?, ?)`).bind(log.dropped_id, t.tag, t.created_at).run();
  const stamp = nowIso();
  await db.prepare(`UPDATE people SET merged_into_id = NULL, updated_at = ? WHERE id = ?`).bind(stamp, log.dropped_id).run();
  await db.prepare(`UPDATE merge_log SET undone_at = ? WHERE id = ?`).bind(stamp, logId).run();
  const [a, b] = log.kept_id < log.dropped_id ? [log.kept_id, log.dropped_id] : [log.dropped_id, log.kept_id];
  await db.prepare(`UPDATE duplicate_suggestions SET status = 'open' WHERE person_a = ? AND person_b = ?`).bind(a, b).run();
  await refreshMarketingStatus(db, log.kept_id);
  await refreshMarketingStatus(db, log.dropped_id);
  return { ok: true };
}

export async function dismissDuplicate(db: D1Like, suggestionId: number): Promise<void> {
  await db.prepare(`UPDATE duplicate_suggestions SET status = 'dismissed' WHERE id = ?`).bind(suggestionId).run();
}

// ------------------------------------------------------------ consent and suppression

export interface ConsentInput {
  channel: 'email' | 'whatsapp';
  action: 'granted' | 'confirmed' | 'withdrawn';
  source: string;
  sourceUrl?: string;
  formId?: string;
  textVersionId?: string;
  ipHash?: string;
  userAgent?: string;
  legalBasis?: 'consent' | 'soft_opt_in' | 'contract';
  doiSentAt?: string | null;
  doiConfirmedAt?: string | null;
  doiTokenHash?: string;
  enteredBy?: string;
  evidenceRef?: string;
}

export async function recordConsent(db: D1Like, personId: string, c: ConsentInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO consent_events (person_id, channel, purpose, action, legal_basis, occurred_at, source, source_url, form_id, text_version_id, ip_hash, user_agent,
         doi_sent_at, doi_confirmed_at, doi_token_hash, entered_by, evidence_ref)
       VALUES (?, ?, 'marketing', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      personId, c.channel, c.action, c.legalBasis ?? 'consent', nowIso(), c.source, c.sourceUrl ?? '', c.formId ?? '', c.textVersionId ?? '', c.ipHash ?? '',
      (c.userAgent ?? '').slice(0, 300), c.doiSentAt ?? null, c.doiConfirmedAt ?? null, c.doiTokenHash ?? '', c.enteredBy ?? '', c.evidenceRef ?? ''
    )
    .run();
  await refreshMarketingStatus(db, personId);
}

export async function isSuppressed(db: D1Like, channel: 'email' | 'whatsapp', identifier: string): Promise<boolean> {
  const norm = channel === 'email' ? normaliseEmail(identifier) : normalisePhone(identifier, { hasCountryCode: true });
  if (!norm) return false;
  const row = await db.prepare(`SELECT 1 AS x FROM suppressions WHERE channel = ? AND identifier_hash = ?`).bind(channel, await hashIdentifier(norm)).first();
  return !!row;
}

// Permanent. Also writes a withdrawal for anyone holding that address, so the ledger agrees.
export async function suppress(db: D1Like, channel: 'email' | 'whatsapp', identifier: string, reason: 'unsubscribe' | 'complaint' | 'hard_bounce' | 'erasure' | 'wa_stop' | 'manual'): Promise<void> {
  const norm = channel === 'email' ? normaliseEmail(identifier) : normalisePhone(identifier, { hasCountryCode: true });
  if (!norm) return;
  await db
    .prepare(`INSERT OR IGNORE INTO suppressions (channel, identifier_hash, identifier_plain, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(channel, await hashIdentifier(norm), norm, reason, nowIso())
    .run();
  const type = channel === 'email' ? 'email' : 'phone';
  const { results } = await db.prepare(`SELECT DISTINCT person_id FROM person_identifiers WHERE type = ? AND value_norm = ?`).bind(type, norm).all<{ person_id: string }>();
  for (const r of results) {
    await recordConsent(db, await rootPerson(db, r.person_id), { channel, action: 'withdrawn', source: reason });
  }
}

// What the ledger and the suppression list say about a person's email marketing.
export async function refreshMarketingStatus(db: D1Like, personId: string): Promise<string> {
  const { results: idents } = await db.prepare(`SELECT value_norm FROM person_identifiers WHERE person_id = ? AND type = 'email'`).bind(personId).all<{ value_norm: string }>();
  let status = 'none';
  for (const i of idents) {
    const sup = await db
      .prepare(`SELECT reason FROM suppressions WHERE channel = 'email' AND identifier_hash = ?`)
      .bind(await hashIdentifier(i.value_norm))
      .first<{ reason: string }>();
    if (sup) {
      status = sup.reason === 'complaint' ? 'complained' : sup.reason === 'hard_bounce' ? 'bounced' : 'unsubscribed';
      break;
    }
  }
  if (status === 'none') {
    const last = await db
      .prepare(`SELECT action FROM consent_events WHERE person_id = ? AND channel = 'email' ORDER BY id DESC LIMIT 1`)
      .bind(personId)
      .first<{ action: string }>();
    status = last?.action === 'confirmed' ? 'subscribed' : last?.action === 'granted' ? 'pending' : last?.action === 'withdrawn' ? 'unsubscribed' : 'none';
  }
  await db.prepare(`UPDATE people SET marketing_status = ?, updated_at = ? WHERE id = ?`).bind(status, nowIso(), personId).run();
  return status;
}
