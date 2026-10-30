import type { APIRoute } from 'astro';
import { resolveEnv } from '../../lib/env';
import { resolveLocale } from '../../lib/i18n';
import { getDictionary } from '../../i18n/dictionaries';
import { hashIp } from '../../lib/aiGuide';
import { normaliseEmail, normalisePhone, recordConsent, recordLead, type Attribution } from '../../lib/contacts';
import { notifyNewLead } from '../../lib/leadsAdmin';
import { consentVersionId, startDoubleOptIn } from '../../lib/marketing';
import type { D1Like } from '../../lib/db';
import { metaContextFromRequest, sendMetaEvent } from '../../lib/metaCapi';
import { sendOpenAiEvent } from '../../lib/openaiCapi';

export const prerender = false;

// Public enquiry form (src/components/EnquiryForm.astro). Every submit becomes a person, a
// touchpoint and a lead in the Leads inbox (src/lib/contacts.ts). Marketing consent is recorded
// only when the visitor ticked the unticked box, with the exact wording they saw.

const PER_IP_PER_HOUR = 5;
const SITE_PER_HOUR = 200;
const HOUR_MS = 60 * 60 * 1000;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : '');

function readAttribution(raw: unknown): Attribution {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    source: clean(o.source, 100),
    medium: clean(o.medium, 100),
    campaign: clean(o.campaign, 150),
    utmContent: clean(o.utmContent, 150),
    utmTerm: clean(o.utmTerm, 150),
    fbclid: clean(o.fbclid, 300),
    gclid: clean(o.gclid, 300),
    referrer: clean(o.referrer, 200),
    landingPage: clean(o.landingPage, 300),
  };
}

export const POST: APIRoute = async ({ request, locals }) => {
  let body: Record<string, unknown> = {};
  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
  } catch {
    return json(400, { error: 'bad_request' });
  }

  // A real visitor never sees this field; a bot fills it. Pretend it worked.
  if (clean(body.website, 50)) return json(200, { ok: true });

  const env = resolveEnv(locals);
  const db: D1Like | undefined = env.DB;
  if (!db) return json(503, { error: 'unavailable' });

  const name = clean(body.name, 120);
  const emailRaw = clean(body.email, 200);
  const phoneRaw = clean(body.phone, 40);
  const email = emailRaw && normaliseEmail(emailRaw) ? emailRaw : '';
  const phone = phoneRaw && normalisePhone(phoneRaw) ? phoneRaw : '';
  if (name.length < 2 || (!email && !phone)) return json(400, { error: 'invalid' });

  const message = clean(body.message, 2000);
  const interest = clean(body.interest, 150);
  const dates = clean(body.dates, 100);
  const locale = resolveLocale(new URL(request.url).searchParams, typeof body.locale === 'string' ? body.locale : undefined);
  const wantsMarketing = body.marketing === true && !!email;

  try {
    const ipHash = await hashIp(request.headers.get('cf-connecting-ip') ?? 'unknown');
    const since = Date.now() - HOUR_MS;
    const [perIp, site] = await Promise.all([
      db.prepare(`SELECT COUNT(*) AS n FROM lead_form_requests WHERE ip_hash = ? AND created_at > ?`).bind(ipHash, since).first<{ n: number }>(),
      db.prepare(`SELECT COUNT(*) AS n FROM lead_form_requests WHERE created_at > ?`).bind(since).first<{ n: number }>(),
    ]);
    if ((perIp?.n ?? 0) >= PER_IP_PER_HOUR || (site?.n ?? 0) >= SITE_PER_HOUR) return json(429, { error: 'rate_limited' });
    await db.prepare(`INSERT INTO lead_form_requests (ip_hash, created_at) VALUES (?, ?)`).bind(ipHash, Date.now()).run();

    const attribution = readAttribution(body.attribution);
    const result = await recordLead(db, {
      channel: 'website',
      identifiers: [
        ...(email ? [{ type: 'email' as const, value: email, source: 'enquiry_form' }] : []),
        ...(phone ? [{ type: 'phone' as const, value: phone, source: 'enquiry_form' }] : []),
      ],
      name,
      language: locale,
      message: [message, dates && `Dates: ${dates}`].filter(Boolean).join('\n'),
      tourInterest: interest,
      travelStart: dates,
      type: 'form',
      externalRef: `form:${crypto.randomUUID()}`,
      attribution,
    });

    if (wantsMarketing) {
      const text = getDictionary(locale).enquiryForm.marketing;
      const version = await consentVersionId('enquiry-form', text);
      await db
        .prepare(`INSERT OR IGNORE INTO consent_texts (version_id, language, text, valid_from) VALUES (?, ?, ?, ?)`)
        .bind(version, locale, text, new Date().toISOString())
        .run();
      await recordConsent(db, result.personId, {
        channel: 'email',
        action: 'granted',
        source: 'website_form',
        sourceUrl: attribution.landingPage ? `https://www.iwisglobal.com${attribution.landingPage}` : 'https://www.iwisglobal.com/contact',
        formId: 'enquiry_form',
        textVersionId: version,
        ipHash,
        userAgent: request.headers.get('user-agent') ?? '',
      });
      // Ticking the box is not enough: the address is subscribed only after the confirmation email is clicked.
      await startDoubleOptIn(env, db, result.personId, email, locale);
    }

    // Tell the owner. A failed alert must not fail the visitor's submit.
    if (result.createdLead) {
      await notifyNewLead(env, db, { id: result.leadId, name, channel: 'Website form', detail: [interest, message].filter(Boolean).join(' / ').slice(0, 300) });
    }
    // The server's copy of the browser's Meta "Lead" (same event id, so Meta counts it once). Only with cookie consent.
    const eventId = clean(body.eventId, 64);
    if (eventId) {
      await sendMetaEvent(
        env,
        { name: 'Lead', eventId, sourceUrl: `https://www.iwisglobal.com${attribution.landingPage || '/contact'}`, email, phone, fullName: name },
        metaContextFromRequest(request)
      );
      // And OpenAI's copy of the browser's lead_created (same event id). Same consent.
      await sendOpenAiEvent(
        env,
        { id: eventId, type: 'lead_created', sourceUrl: `https://www.iwisglobal.com${attribution.landingPage || '/contact'}`, email, externalId: result.personId ? String(result.personId) : undefined },
        metaContextFromRequest(request)
      );
    }
    return json(200, { ok: true });
  } catch (err) {
    console.error('leads: enquiry failed', err instanceof Error ? err.message : 'error');
    return json(500, { error: 'failed' });
  }
};
