import type { D1Like } from './db';
import { newLinkToken, hashLinkToken } from './oneTimeLinks';
import { hashIdentifier, normaliseEmail, recordConsent, refreshMarketingStatus, rootPerson, suppress } from './contacts';
import { sendOptInConfirmationEmail } from './email';
import { emailLocale } from './i18n';

// Marketing email consent: double opt-in, unsubscribe, erasure. Nobody is "subscribed" until they have
// clicked the link in a confirmation email (consent_events action 'confirmed'); an unsubscribe is a permanent
// suppression until the person makes a fresh, confirmed opt-in. Complaints, hard bounces and erasures are
// never lifted by a signup.

export const SITE_URL = 'https://www.iwisglobal.com';
const CONFIRM_TTL_MS = 7 * 24 * 3600_000;
const MAX_CONFIRMATIONS_PER_HOUR = 3;
const NEVER_LIFT = ['complaint', 'hard_bounce', 'erasure'];

const nowIso = () => new Date().toISOString();

// --------------------------------------------------------------- tokens

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// A stateless unsubscribe token: "<person id>.<signature>". It carries no email address and needs no table.
export async function signUnsubscribeToken(secret: string, personId: string): Promise<string> {
  return `${personId}.${(await hmacHex(secret, `unsub:${personId}`)).slice(0, 32)}`;
}

// The person id for a valid token, else null.
export async function verifyUnsubscribeToken(secret: string | undefined, token: string): Promise<string | null> {
  if (!secret || !token || token.length > 120) return null;
  const i = token.lastIndexOf('.');
  if (i < 1) return null;
  const personId = token.slice(0, i);
  const expected = (await hmacHex(secret, `unsub:${personId}`)).slice(0, 32);
  return timingSafeEqual(token.slice(i + 1), expected) ? personId : null;
}

export const unsubscribeUrl = (token: string, locale: string): string => `${SITE_URL}/unsubscribe/${encodeURIComponent(token)}${locale && locale !== 'en' ? `?lang=${locale}` : ''}`;

// The exact wording shown beside a consent box gets an id that changes when the text changes, so a stored
// consent can never point at wording the person did not see.
export async function consentVersionId(form: string, text: string): Promise<string> {
  return `${form}-${(await hashLinkToken(text)).slice(0, 8)}`;
}

// ------------------------------------------------------------ double opt-in

export async function personEmails(db: D1Like, personId: string): Promise<{ value_raw: string; value_norm: string }[]> {
  return (await db.prepare(`SELECT value_raw, value_norm FROM person_identifiers WHERE person_id = ? AND type = 'email' AND is_shared = 0`).bind(personId).all<{ value_raw: string; value_norm: string }>()).results;
}

async function suppressionReason(db: D1Like, norm: string): Promise<string | null> {
  const row = await db.prepare(`SELECT reason FROM suppressions WHERE channel = 'email' AND identifier_hash = ?`).bind(await hashIdentifier(norm)).first<{ reason: string }>();
  return row?.reason ?? null;
}

export type OptInResult = 'sent' | 'already' | 'blocked' | 'rate_limited' | 'invalid' | 'failed';

// Sends the one neutral confirmation email. Never throws into a form submit.
export async function startDoubleOptIn(env: Record<string, any>, db: D1Like, personId: string, email: string, language?: string): Promise<OptInResult> {
  try {
    const norm = normaliseEmail(email);
    if (!norm) return 'invalid';
    const person = await rootPerson(db, personId);
    const reason = await suppressionReason(db, norm);
    if (reason && NEVER_LIFT.includes(reason)) return 'blocked';
    const status = await db.prepare(`SELECT marketing_status FROM people WHERE id = ?`).bind(person).first<{ marketing_status: string }>();
    if (status?.marketing_status === 'subscribed') return 'already';

    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const recent = await db.prepare(`SELECT COUNT(*) AS n FROM email_confirmations WHERE email = ? AND created_at > ?`).bind(norm, hourAgo).first<{ n: number }>();
    if ((recent?.n ?? 0) >= MAX_CONFIRMATIONS_PER_HOUR) return 'rate_limited';

    const locale = emailLocale(language);
    const token = newLinkToken();
    const now = Date.now();
    await db
      .prepare(`INSERT INTO email_confirmations (token_hash, person_id, email, locale, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(await hashLinkToken(token), person, norm, locale, new Date(now + CONFIRM_TTL_MS).toISOString(), new Date(now).toISOString())
      .run();
    const link = `${SITE_URL}/confirm-subscription?t=${encodeURIComponent(token)}${locale === 'en' ? '' : `&lang=${locale}`}`;
    const ok = await sendOptInConfirmationEmail(env, { to: email.trim(), link, locale });
    return ok ? 'sent' : 'failed';
  } catch (err) {
    console.error('marketing: opt-in start failed', err instanceof Error ? err.message : 'error');
    return 'failed';
  }
}

export type ConfirmResult = { ok: true; personId: string } | { ok: false };

// A valid link subscribes the person. Only an earlier "unsubscribe" suppression is lifted: this is the
// fresh, logged opt-in that is allowed to override it. Used once.
export async function confirmOptIn(db: D1Like, token: string, meta: { ipHash?: string; userAgent?: string } = {}): Promise<ConfirmResult> {
  if (!token || token.length > 100) return { ok: false };
  const hash = await hashLinkToken(token);
  const row = await db
    .prepare(`SELECT person_id, email, created_at FROM email_confirmations WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`)
    .bind(hash, nowIso())
    .first<{ person_id: string; email: string; created_at: string }>();
  if (!row) return { ok: false };
  const claim = await db.prepare(`UPDATE email_confirmations SET used_at = ? WHERE token_hash = ? AND used_at IS NULL`).bind(nowIso(), hash).run();
  if (!claim.meta?.changes) return { ok: false };

  const person = await rootPerson(db, row.person_id);
  const reason = await suppressionReason(db, row.email);
  if (reason && NEVER_LIFT.includes(reason)) return { ok: false };
  if (reason) await db.prepare(`DELETE FROM suppressions WHERE channel = 'email' AND identifier_hash = ?`).bind(await hashIdentifier(row.email)).run();

  const last = await db
    .prepare(`SELECT text_version_id, form_id, source_url FROM consent_events WHERE person_id = ? AND channel = 'email' AND action = 'granted' ORDER BY id DESC LIMIT 1`)
    .bind(person)
    .first<{ text_version_id: string; form_id: string; source_url: string }>();
  await recordConsent(db, person, {
    channel: 'email',
    action: 'confirmed',
    source: 'double_opt_in',
    sourceUrl: last?.source_url ?? '',
    formId: last?.form_id ?? '',
    textVersionId: last?.text_version_id ?? '',
    doiSentAt: row.created_at,
    doiConfirmedAt: nowIso(),
    doiTokenHash: hash,
    ipHash: meta.ipHash,
    userAgent: meta.userAgent,
  });
  return { ok: true, personId: person };
}

// ------------------------------------------------------------- unsubscribe

// Stops marketing to every address the person has. Booking and payment emails are not marketing and continue.
export async function unsubscribePerson(db: D1Like, personId: string, reason: 'unsubscribe' | 'manual' = 'unsubscribe'): Promise<number> {
  const person = await rootPerson(db, personId);
  const emails = await personEmails(db, person);
  for (const e of emails) await suppress(db, 'email', e.value_norm, reason);
  await refreshMarketingStatus(db, person);
  return emails.length;
}

// Everyone who may receive marketing email: confirmed, and not suppressed (marketing_status already folds
// suppressions in). Re-check isSuppressed again at send time.
export async function listSubscribed(db: D1Like, limit = 5000): Promise<{ person_id: string; email: string; language: string }[]> {
  return (
    await db
      .prepare(
        `SELECT p.id AS person_id, p.language AS language, (SELECT i.value_raw FROM person_identifiers i WHERE i.person_id = p.id AND i.type = 'email' AND i.is_shared = 0 ORDER BY i.id LIMIT 1) AS email
           FROM people p WHERE p.merged_into_id IS NULL AND p.marketing_status = 'subscribed' LIMIT ?`
      )
      .bind(limit)
      .all<{ person_id: string; email: string; language: string }>()
  ).results.filter((r) => !!r.email);
}

// ----------------------------------------------------------------- erasure

// Deletes what identifies the person. Only a hashed copy of their email addresses stays (as an "erasure"
// suppression), so they are never emailed again. Leads stay as anonymous statistics (stage, channel, campaign).
export async function erasePerson(db: D1Like, personId: string): Promise<{ emails: number }> {
  const person = await rootPerson(db, personId);
  const emails = await personEmails(db, person);
  for (const e of emails) {
    await suppress(db, 'email', e.value_norm, 'erasure');
    await db.prepare(`UPDATE suppressions SET identifier_plain = '' WHERE channel = 'email' AND identifier_hash = ?`).bind(await hashIdentifier(e.value_norm)).run();
  }
  const phones = (await db.prepare(`SELECT value_norm FROM person_identifiers WHERE person_id = ? AND type IN ('phone','wa_id')`).bind(person).all<{ value_norm: string }>()).results;
  for (const p of phones) {
    await suppress(db, 'whatsapp', p.value_norm, 'erasure');
    await db.prepare(`UPDATE suppressions SET identifier_plain = '' WHERE channel = 'whatsapp' AND identifier_hash = ?`).bind(await hashIdentifier(p.value_norm)).run();
  }
  const stamp = nowIso();
  await db.prepare(`UPDATE leads SET name = '(erased)', email = '', phone = '', message = '', tour_interest = '', updated_at = ? WHERE person_id = ?`).bind(stamp, person).run();
  for (const table of ['person_identifiers', 'touchpoints', 'lead_activities', 'consent_events', 'person_tags', 'email_confirmations']) {
    await db.prepare(`DELETE FROM ${table} WHERE person_id = ?`).bind(person).run();
  }
  await db.prepare(`DELETE FROM duplicate_suggestions WHERE person_a = ? OR person_b = ?`).bind(person, person).run();
  await db
    .prepare(`UPDATE people SET display_name = '(erased)', first_name = '', last_name = '', country = '', language = '', marketing_status = 'unsubscribed', updated_at = ? WHERE id = ?`)
    .bind(stamp, person)
    .run();
  return { emails: emails.length };
}
