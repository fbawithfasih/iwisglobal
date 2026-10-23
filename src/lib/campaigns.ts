import type { D1Like } from './db';
import { isSuppressed } from './contacts';
import { postBatch, postEmail, marketingEmail } from './email';
import { signUnsubscribeToken, unsubscribeUrl, SITE_URL } from './marketing';
import { callAnthropic } from './aiGuide';
import { getTourBySlug } from './tours';
import { formatMoneyMinor } from './format';
import { emailLocale, type Locale } from './i18n';
import { fmt } from '../i18n/fmt';
import { getDictionary } from '../i18n/dictionaries';

// Email campaigns: write once in English, translate and approve per language, pick an audience of confirmed
// subscribers, test, then send in batches. Every real send needs MARKETING_SENDING_ENABLED=1, a test send, and
// English content; a translation nobody has approved is never sent (those people get English instead).

export const CAMPAIGN_LANGS = ['en', 'de', 'fr', 'es'] as const;
export const LANG_NAMES: Record<string, string> = { en: 'English', de: 'German', fr: 'French', es: 'Spanish' };
export const CHUNK_SIZE = 100;
export const DEFAULT_DAILY_CAP = 200;
const CHUNKS_PER_TICK = 5;

const nowIso = () => new Date().toISOString();

export interface CampaignRow {
  id: string;
  name: string;
  status: string;
  segment_json: string;
  scheduled_at: string | null;
  tested_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  last_error: string;
  created_at: string;
}

export interface CampaignContent {
  language: string;
  subject: string;
  preheader: string;
  headline: string;
  intro: string;
  block1: string;
  block2: string;
  block3: string;
  tour_slug: string;
  cta_label: string;
  cta_url: string;
  reviewed: number;
}

export const EMPTY_CONTENT = (language: string): CampaignContent => ({ language, subject: '', preheader: '', headline: '', intro: '', block1: '', block2: '', block3: '', tour_slug: '', cta_label: '', cta_url: '', reviewed: 0 });

// -------------------------------------------------------------- audience

export interface Segment {
  languages?: string[];
  countries?: string[];
  stages?: string[];
  channels?: string[];
  tag?: string;
  pastBooker?: boolean;
}

const list = (v: unknown, max = 20): string[] => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, max) : []);

export function parseSegment(json: string): Segment {
  try {
    const s = JSON.parse(json || '{}');
    return {
      languages: list(s.languages),
      countries: list(s.countries).map((c) => c.toUpperCase()),
      stages: list(s.stages),
      channels: list(s.channels),
      tag: typeof s.tag === 'string' ? s.tag.trim().slice(0, 60) : '',
      pastBooker: s.pastBooker === true,
    };
  } catch {
    return {};
  }
}

// Who a segment means. It always starts from confirmed subscribers (marketing_status folds in every suppression),
// so a filter can only narrow the list, never widen it.
export function segmentSql(seg: Segment): { where: string; args: unknown[] } {
  const where: string[] = [`p.merged_into_id IS NULL`, `p.marketing_status = 'subscribed'`];
  const args: unknown[] = [];
  const marks = (n: number) => Array(n).fill('?').join(',');
  if (seg.languages?.length) {
    // A person with no language recorded is read as English.
    where.push(`(p.language IN (${marks(seg.languages.length)})${seg.languages.includes('en') ? ` OR p.language = ''` : ''})`);
    args.push(...seg.languages);
  }
  if (seg.countries?.length) {
    where.push(`p.country IN (${marks(seg.countries.length)})`);
    args.push(...seg.countries);
  }
  if (seg.stages?.length) {
    where.push(`EXISTS (SELECT 1 FROM leads l WHERE l.person_id = p.id AND l.status IN (${marks(seg.stages.length)}))`);
    args.push(...seg.stages);
  }
  if (seg.channels?.length) {
    where.push(`EXISTS (SELECT 1 FROM leads l WHERE l.person_id = p.id AND l.channel IN (${marks(seg.channels.length)}))`);
    args.push(...seg.channels);
  }
  if (seg.tag) {
    where.push(`EXISTS (SELECT 1 FROM person_tags t WHERE t.person_id = p.id AND t.tag = ?)`);
    args.push(seg.tag);
  }
  if (seg.pastBooker) where.push(`EXISTS (SELECT 1 FROM leads l WHERE l.person_id = p.id AND l.booking_id IS NOT NULL)`);
  return { where: where.join(' AND '), args };
}

export interface Recipient {
  person_id: string;
  email: string;
  language: string;
  country: string;
}

export async function audience(db: D1Like, seg: Segment, limit = 20000): Promise<Recipient[]> {
  const { where, args } = segmentSql(seg);
  const rows = (
    await db
      .prepare(
        `SELECT p.id AS person_id, p.language AS language, p.country AS country,
                (SELECT i.value_raw FROM person_identifiers i WHERE i.person_id = p.id AND i.type = 'email' AND i.is_shared = 0 ORDER BY i.id LIMIT 1) AS email
           FROM people p WHERE ${where} ORDER BY p.id LIMIT ?`
      )
      .bind(...args, limit)
      .all<Recipient>()
  ).results;
  return rows.filter((r) => !!r.email).map((r) => ({ ...r, language: r.language || 'en' }));
}

export function languageCounts(rs: Recipient[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rs) out[r.language] = (out[r.language] ?? 0) + 1;
  return out;
}

// ------------------------------------------------------------- content

export async function loadContent(db: D1Like, campaignId: string): Promise<Record<string, CampaignContent>> {
  const rows = (await db.prepare(`SELECT * FROM campaign_content WHERE campaign_id = ?`).bind(campaignId).all<CampaignContent>()).results;
  const out: Record<string, CampaignContent> = {};
  for (const r of rows) out[r.language] = r;
  return out;
}

export const contentComplete = (c: CampaignContent | undefined): boolean => !!c && !!c.subject.trim() && !!c.headline.trim() && !!c.intro.trim();

// The language a person's email is written in: their own if that version is complete and approved, else English.
export function languageFor(personLang: string, content: Record<string, CampaignContent>): string {
  const c = content[personLang];
  return personLang !== 'en' && contentComplete(c) && c.reviewed === 1 ? personLang : 'en';
}

// Everything that must be true before a real send. Empty list = ready.
export async function readiness(env: Record<string, any>, db: D1Like, campaign: CampaignRow): Promise<string[]> {
  const problems: string[] = [];
  const content = await loadContent(db, campaign.id);
  if (!contentComplete(content.en)) problems.push('The English version needs a subject, a headline and an intro.');
  if (!campaign.tested_at) problems.push('Send yourself a test first.');
  if (env.MARKETING_SENDING_ENABLED !== '1') problems.push('Sending is switched off (MARKETING_SENDING_ENABLED).');
  if (!env.MARKETING_EMAIL_FROM) problems.push('The marketing sender address is not set (MARKETING_EMAIL_FROM).');
  if (!env.UNSUBSCRIBE_SECRET) problems.push('The unsubscribe secret is not set (UNSUBSCRIBE_SECRET).');
  if (!env.RESEND_API_KEY) problems.push('Email sending is not configured (RESEND_API_KEY).');
  return problems;
}

// ----------------------------------------------------------- rendering

export interface Rendered {
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
}

const utm = (url: string, campaignId: string): string => {
  try {
    const u = new URL(url);
    u.searchParams.set('utm_source', 'email');
    u.searchParams.set('utm_medium', 'newsletter');
    u.searchParams.set('utm_campaign', campaignId);
    return u.toString();
  } catch {
    return url;
  }
};

export async function renderCampaignEmail(
  db: D1Like,
  campaignId: string,
  c: CampaignContent,
  who: { language: string; country: string; unsubscribeLink: string }
): Promise<Rendered> {
  const locale = emailLocale(c.language) as Locale;
  const M = getDictionary(locale).emails.marketing;
  let tour: { title: string; image: string; url: string; priceLine: string } | undefined;
  if (c.tour_slug) {
    const t = await getTourBySlug(db, c.tour_slug, locale).catch(() => null);
    if (t) {
      // Outside India the dollar price is shown when the tour has one.
      const usd = who.country !== 'IN' && t.usdAmount != null;
      const price = formatMoneyMinor((usd ? (t.usdAmount as number) : t.amount) * 100, usd ? 'USD' : 'INR');
      tour = {
        title: t.title,
        image: t.image ? (t.image.startsWith('http') ? t.image : `${SITE_URL}${t.image}`) : '',
        url: utm(`${SITE_URL}${locale === 'en' ? '' : `/${locale}`}/tours/${t.slug}`, campaignId),
        priceLine: fmt(M.priceFrom, { price }),
      };
    }
  }
  const cta = c.cta_label.trim() && /^https?:\/\//i.test(c.cta_url.trim()) ? { label: c.cta_label.trim(), url: utm(c.cta_url.trim(), campaignId) } : undefined;
  const { html, text } = marketingEmail({
    locale,
    preheader: c.preheader || c.intro.slice(0, 120),
    headline: c.headline,
    intro: c.intro,
    blocks: [c.block1, c.block2, c.block3].filter((b) => b.trim()),
    tour,
    cta,
    unsubscribeUrl: who.unsubscribeLink,
  });
  return {
    subject: c.subject,
    html,
    text,
    headers: {
      'List-Unsubscribe': `<${who.unsubscribeLink}>, <mailto:info@iwisglobal.com?subject=unsubscribe>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

// ---------------------------------------------------------------- tests

// A test goes to the owner's own addresses only (at most five), is clearly marked, never touches the send ledger, and
// unlocks the real send.
export async function sendTest(env: Record<string, any>, db: D1Like, campaign: CampaignRow, to: string[], language: string): Promise<{ sent: number; error?: string }> {
  const content = await loadContent(db, campaign.id);
  const c = content[language] ?? content.en;
  if (!contentComplete(c)) return { sent: 0, error: 'That version needs a subject, a headline and an intro first.' };
  const addresses = to.map((a) => a.trim()).filter((a) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a)).slice(0, 5);
  if (addresses.length === 0) return { sent: 0, error: 'Enter at least one valid email address.' };
  const from = env.MARKETING_EMAIL_FROM || env.BOOKING_EMAIL_FROM || 'IWIS Global <info@iwisglobal.com>';
  let sent = 0;
  for (const a of addresses) {
    const r = await renderCampaignEmail(db, campaign.id, c, { language: c.language, country: '', unsubscribeLink: `${SITE_URL}/unsubscribe/test` });
    const ok = await postEmail(env, 'campaign test', { from, to: a, subject: `[TEST] ${r.subject}`, html: r.html, text: r.text, reply_to: 'info@iwisglobal.com' });
    if (ok) sent++;
  }
  if (sent > 0) await db.prepare(`UPDATE campaigns SET tested_at = ?, updated_at = ? WHERE id = ?`).bind(nowIso(), nowIso(), campaign.id).run();
  return { sent, error: sent === 0 ? 'The test could not be sent. Check the Resend settings.' : undefined };
}

// ------------------------------------------------------------ translation

const TRANSLATE_SYSTEM = `You translate marketing email copy for IWIS Global, a private Taj Mahal and Agra tour company in India, from English into the requested language. Keep it warm, clear and natural for travellers, not salesy. Keep brand and place names (IWIS Global, Taj Mahal, Agra), numbers, prices and URLs exactly. Do not add or remove claims. Keep paragraph breaks. Reply with ONLY a JSON object with the same keys as the input and translated string values, no markdown fences.`;

const TRANSLATABLE = ['subject', 'preheader', 'headline', 'intro', 'block1', 'block2', 'block3', 'cta_label'] as const;

export function parseTranslation(text: string): Partial<Record<(typeof TRANSLATABLE)[number], string>> | null {
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    const o = JSON.parse(text.slice(start, end + 1));
    const out: Partial<Record<(typeof TRANSLATABLE)[number], string>> = {};
    for (const k of TRANSLATABLE) if (typeof o[k] === 'string') out[k] = o[k];
    return out.subject && out.headline && out.intro ? out : null;
  } catch {
    return null;
  }
}

// Drafts a translation of the English version and saves it UNAPPROVED. Returns an error message or null.
export async function translateContent(env: Record<string, any>, db: D1Like, campaignId: string, language: string): Promise<string | null> {
  if (!env.ANTHROPIC_API_KEY) return 'Translation is not configured (ANTHROPIC_API_KEY).';
  if (!LANG_NAMES[language] || language === 'en') return 'Choose German, French or Spanish.';
  const content = await loadContent(db, campaignId);
  const en = content.en;
  if (!contentComplete(en)) return 'Write the English version first.';
  const source: Record<string, string> = {};
  for (const k of TRANSLATABLE) source[k] = en[k];
  try {
    const { text } = await callAnthropic({
      apiKey: env.ANTHROPIC_API_KEY,
      model: 'claude-haiku-4-5-20251001',
      system: `${TRANSLATE_SYSTEM}\nTarget language: ${LANG_NAMES[language]}.`,
      messages: [{ role: 'user', content: JSON.stringify(source) }],
      maxTokens: 2500,
      timeoutMs: 25000,
    });
    const t = parseTranslation(text);
    if (!t) return 'The translation came back in an unexpected form. Please try again.';
    await saveContent(db, campaignId, { ...EMPTY_CONTENT(language), ...en, ...t, language, reviewed: 0 });
    return null;
  } catch {
    return 'The translation could not be made right now. Please try again.';
  }
}

export async function saveContent(db: D1Like, campaignId: string, c: CampaignContent): Promise<void> {
  await db
    .prepare(
      `INSERT INTO campaign_content (campaign_id, language, subject, preheader, headline, intro, block1, block2, block3, tour_slug, cta_label, cta_url, reviewed, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(campaign_id, language) DO UPDATE SET subject = excluded.subject, preheader = excluded.preheader, headline = excluded.headline, intro = excluded.intro,
         block1 = excluded.block1, block2 = excluded.block2, block3 = excluded.block3, tour_slug = excluded.tour_slug, cta_label = excluded.cta_label,
         cta_url = excluded.cta_url, reviewed = excluded.reviewed, updated_at = excluded.updated_at`
    )
    .bind(campaignId, c.language, c.subject.slice(0, 200), c.preheader.slice(0, 200), c.headline.slice(0, 200), c.intro.slice(0, 4000), c.block1.slice(0, 4000), c.block2.slice(0, 4000), c.block3.slice(0, 4000), c.tour_slug.slice(0, 100), c.cta_label.slice(0, 80), c.cta_url.slice(0, 500), c.reviewed ? 1 : 0, nowIso())
    .run();
}

// --------------------------------------------------------------- lifecycle

export async function createCampaign(db: D1Like, name: string, by: string): Promise<string> {
  const id = `cmp_${crypto.randomUUID()}`;
  const stamp = nowIso();
  await db.prepare(`INSERT INTO campaigns (id, name, status, segment_json, created_by, created_at, updated_at) VALUES (?, ?, 'draft', '{}', ?, ?, ?)`).bind(id, name.slice(0, 120) || 'New campaign', by, stamp, stamp).run();
  return id;
}

export async function getCampaign(db: D1Like, id: string): Promise<CampaignRow | null> {
  return db.prepare(`SELECT * FROM campaigns WHERE id = ?`).bind(id).first<CampaignRow>();
}

// Puts the audience in the send ledger (once; INSERT OR IGNORE) and starts sending. Errors come back as text.
export async function startCampaign(env: Record<string, any>, db: D1Like, campaign: CampaignRow): Promise<string[]> {
  if (campaign.status !== 'draft' && campaign.status !== 'scheduled') return ['This campaign has already been started.'];
  const problems = await readiness(env, db, campaign);
  if (problems.length) return problems;
  const content = await loadContent(db, campaign.id);
  const people = await audience(db, parseSegment(campaign.segment_json));
  if (people.length === 0) return ['No confirmed subscribers match this audience.'];
  const stamp = nowIso();
  for (const r of people) {
    await db
      .prepare(`INSERT OR IGNORE INTO campaign_sends (campaign_id, person_id, email, language, status, queued_at) VALUES (?, ?, ?, ?, 'queued', ?)`)
      .bind(campaign.id, r.person_id, r.email, languageFor(r.language, content), stamp)
      .run();
  }
  await db.prepare(`UPDATE campaigns SET status = 'sending', started_at = COALESCE(started_at, ?), last_error = '', updated_at = ? WHERE id = ?`).bind(stamp, stamp, campaign.id).run();
  return [];
}

export async function schedule(db: D1Like, campaignId: string, whenIso: string | null): Promise<void> {
  await db.prepare(`UPDATE campaigns SET status = ?, scheduled_at = ?, updated_at = ? WHERE id = ? AND status IN ('draft','scheduled')`).bind(whenIso ? 'scheduled' : 'draft', whenIso, nowIso(), campaignId).run();
}

export async function cancelCampaign(db: D1Like, campaignId: string): Promise<void> {
  await db.prepare(`UPDATE campaign_sends SET status = 'skipped', error = 'campaign cancelled' WHERE campaign_id = ? AND status = 'queued'`).bind(campaignId).run();
  await db.prepare(`UPDATE campaigns SET status = 'cancelled', finished_at = ?, updated_at = ? WHERE id = ? AND status IN ('draft','scheduled','sending')`).bind(nowIso(), nowIso(), campaignId).run();
}

export async function sendCounts(db: D1Like, campaignId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = { queued: 0, sent: 0, failed: 0, skipped: 0 };
  for (const r of (await db.prepare(`SELECT status, COUNT(*) AS n FROM campaign_sends WHERE campaign_id = ? GROUP BY status`).bind(campaignId).all<{ status: string; n: number }>()).results) out[r.status] = r.n;
  return out;
}

async function sentToday(db: D1Like): Promise<number> {
  const day = nowIso().slice(0, 10);
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM campaign_sends WHERE status = 'sent' AND sent_at >= ?`).bind(day).first<{ n: number }>();
  return row?.n ?? 0;
}

export interface ChunkResult {
  sent: number;
  skipped: number;
  failed: number;
  remaining: number;
  blocked?: string;
}

// Sends the next batch of up to 100. Safe to call again at any time: rows move out of "queued" only once Resend
// has answered, and a retried batch reuses its Idempotency-Key.
export async function sendNextChunk(env: Record<string, any>, db: D1Like, campaignId: string): Promise<ChunkResult> {
  const result: ChunkResult = { sent: 0, skipped: 0, failed: 0, remaining: 0 };
  const campaign = await getCampaign(db, campaignId);
  if (!campaign || campaign.status !== 'sending') return { ...result, blocked: 'not sending' };
  if (env.MARKETING_SENDING_ENABLED !== '1') return { ...result, blocked: 'Sending is switched off.' };
  if (!env.MARKETING_EMAIL_FROM || !env.UNSUBSCRIBE_SECRET || !env.RESEND_API_KEY) return { ...result, blocked: 'Sender settings are missing.' };

  const cap = Math.max(1, Number(env.MARKETING_DAILY_CAP) || DEFAULT_DAILY_CAP);
  const room = cap - (await sentToday(db));
  if (room <= 0) return { ...result, remaining: (await sendCounts(db, campaignId)).queued, blocked: 'Daily sending limit reached; it continues tomorrow.' };

  const rows = (
    await db
      .prepare(`SELECT id, person_id, email, language FROM campaign_sends WHERE campaign_id = ? AND status = 'queued' ORDER BY id LIMIT ?`)
      .bind(campaignId, Math.min(CHUNK_SIZE, room))
      .all<{ id: number; person_id: string; email: string; language: string }>()
  ).results;
  if (rows.length === 0) {
    await db.prepare(`UPDATE campaigns SET status = 'sent', finished_at = ?, updated_at = ? WHERE id = ? AND status = 'sending'`).bind(nowIso(), nowIso(), campaignId).run();
    return result;
  }

  const content = await loadContent(db, campaignId);
  const stamp = nowIso();
  const ready: { row: (typeof rows)[number]; payload: Record<string, unknown> }[] = [];
  for (const row of rows) {
    // Check again now: they may have unsubscribed, bounced or complained since the campaign was queued.
    const p = await db.prepare(`SELECT marketing_status, country FROM people WHERE id = ?`).bind(row.person_id).first<{ marketing_status: string; country: string }>();
    if (!p || p.marketing_status !== 'subscribed' || (await isSuppressed(db, 'email', row.email))) {
      await db.prepare(`UPDATE campaign_sends SET status = 'skipped', error = 'no longer subscribed' WHERE id = ?`).bind(row.id).run();
      result.skipped++;
      continue;
    }
    const c = content[row.language] ?? content.en;
    const link = unsubscribeUrl(await signUnsubscribeToken(env.UNSUBSCRIBE_SECRET, row.person_id), c.language);
    const r = await renderCampaignEmail(db, campaignId, c, { language: c.language, country: p.country, unsubscribeLink: link });
    ready.push({
      row,
      payload: { from: env.MARKETING_EMAIL_FROM, to: [row.email], reply_to: 'info@iwisglobal.com', subject: r.subject, html: r.html, text: r.text, headers: r.headers, tags: [{ name: 'campaign', value: campaignId.replace(/[^A-Za-z0-9_-]/g, '_') }] },
    });
  }

  if (ready.length > 0) {
    const key = `cmp:${campaignId}:${ready[0].row.id}:${ready.length}`;
    const res = await postBatch(env, 'campaign batch', ready.map((r) => r.payload), key);
    if (res.ok && res.ids.length === ready.length) {
      for (let i = 0; i < ready.length; i++) {
        await db.prepare(`UPDATE campaign_sends SET status = 'sent', resend_id = ?, sent_at = ?, error = '' WHERE id = ? AND status = 'queued'`).bind(res.ids[i], stamp, ready[i].row.id).run();
      }
      result.sent = ready.length;
    } else if (res.status === 429 || res.status === 0 || res.status >= 500 || res.ok) {
      // Throttled or a hiccup: leave them queued so the next tick retries (same Idempotency-Key).
      await db.prepare(`UPDATE campaigns SET last_error = ?, updated_at = ? WHERE id = ?`).bind((res.error ?? 'unexpected answer').slice(0, 300), stamp, campaignId).run();
      result.blocked = 'Resend is busy; it will retry shortly.';
    } else {
      // A rejection that retrying will not fix: mark the rows so the campaign cannot loop forever.
      for (const r of ready) await db.prepare(`UPDATE campaign_sends SET status = 'failed', error = ? WHERE id = ?`).bind((res.error ?? 'rejected').slice(0, 300), r.row.id).run();
      await db.prepare(`UPDATE campaigns SET last_error = ?, updated_at = ? WHERE id = ?`).bind((res.error ?? 'rejected').slice(0, 300), stamp, campaignId).run();
      result.failed = ready.length;
    }
  }

  result.remaining = (await sendCounts(db, campaignId)).queued;
  if (result.remaining === 0 && !result.blocked) {
    await db.prepare(`UPDATE campaigns SET status = 'sent', finished_at = ?, updated_at = ? WHERE id = ? AND status = 'sending'`).bind(nowIso(), nowIso(), campaignId).run();
  }
  return result;
}

// The scheduled job: start campaigns whose time has come, then keep every sending campaign moving.
export async function tick(env: Record<string, any>, db: D1Like, pause = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<{ started: number; chunks: number }> {
  let started = 0;
  let chunks = 0;
  const due = (await db.prepare(`SELECT * FROM campaigns WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ?`).bind(nowIso()).all<CampaignRow>()).results;
  for (const c of due) {
    const problems = await startCampaign(env, db, c);
    if (problems.length === 0) started++;
    else await db.prepare(`UPDATE campaigns SET last_error = ?, updated_at = ? WHERE id = ?`).bind(problems.join(' ').slice(0, 300), nowIso(), c.id).run();
  }
  const sending = (await db.prepare(`SELECT id FROM campaigns WHERE status = 'sending' ORDER BY started_at LIMIT 3`).bind().all<{ id: string }>()).results;
  for (const s of sending) {
    for (let i = 0; i < CHUNKS_PER_TICK; i++) {
      const r = await sendNextChunk(env, db, s.id);
      chunks++;
      if (r.blocked || r.remaining === 0) break;
      await pause(700); // Resend allows 10 requests a second across the whole account
    }
  }
  return { started, chunks };
}
