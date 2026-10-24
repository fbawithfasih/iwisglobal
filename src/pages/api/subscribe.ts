import type { APIRoute } from 'astro';
import { resolveEnv } from '../../lib/env';
import { resolveLocale } from '../../lib/i18n';
import { getDictionary } from '../../i18n/dictionaries';
import { hashIp } from '../../lib/aiGuide';
import { normaliseEmail } from '../../lib/contacts';
import { signUpForEmail } from '../../lib/marketing';
import type { D1Like } from '../../lib/db';

export const prerender = false;

// Footer newsletter signup. It records the person and the wording they agreed to, then sends the one
// confirmation email (double opt-in); nobody is subscribed until they click it. It never opens a lead, and
// the answer is always the same so it cannot be used to find out whether an address is already known.

const PER_IP_PER_HOUR = 5;
const SITE_PER_HOUR = 200;
const HOUR_MS = 3600_000;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : '');

export const POST: APIRoute = async ({ request, locals }) => {
  let body: Record<string, unknown> = {};
  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
  } catch {
    return json(400, { error: 'bad_request' });
  }
  if (clean(body.website, 50)) return json(200, { ok: true });

  const env = resolveEnv(locals);
  const db: D1Like | undefined = env.DB;
  if (!db) return json(503, { error: 'unavailable' });

  const email = clean(body.email, 200);
  if (!email || !normaliseEmail(email)) return json(400, { error: 'invalid' });
  // The box must have been ticked: consent is never assumed.
  if (body.consent !== true) return json(400, { error: 'consent_required' });
  const locale = resolveLocale(new URL(request.url).searchParams, typeof body.locale === 'string' ? body.locale : undefined);

  try {
    const ipHash = await hashIp(request.headers.get('cf-connecting-ip') ?? 'unknown');
    const since = Date.now() - HOUR_MS;
    const [perIp, site] = await Promise.all([
      db.prepare(`SELECT COUNT(*) AS n FROM lead_form_requests WHERE ip_hash = ? AND created_at > ?`).bind(ipHash, since).first<{ n: number }>(),
      db.prepare(`SELECT COUNT(*) AS n FROM lead_form_requests WHERE created_at > ?`).bind(since).first<{ n: number }>(),
    ]);
    if ((perIp?.n ?? 0) >= PER_IP_PER_HOUR || (site?.n ?? 0) >= SITE_PER_HOUR) return json(429, { error: 'rate_limited' });
    await db.prepare(`INSERT INTO lead_form_requests (ip_hash, created_at) VALUES (?, ?)`).bind(ipHash, Date.now()).run();

    // The footer box, or the standalone /subscribe page (linked from WhatsApp replies); nothing else is trusted from the client.
    const onPage = body.form === 'subscribe_page';
    await signUpForEmail(env, db, {
      email,
      locale,
      page: clean(body.page, 200) || '/',
      formId: onPage ? 'subscribe_page' : 'footer_newsletter',
      source: onPage ? (body.src === 'whatsapp' ? 'whatsapp_link' : 'subscribe_page') : 'footer_signup',
      consentText: getDictionary(locale).newsletter.consent,
      ipHash,
      userAgent: request.headers.get('user-agent') ?? '',
    });
    return json(200, { ok: true });
  } catch (err) {
    console.error('subscribe failed', err instanceof Error ? err.message : 'error');
    return json(500, { error: 'failed' });
  }
};
