import type { APIRoute } from 'astro';
import { resolveEnv } from '../../lib/env';
import { resolveLocale } from '../../lib/i18n';
import { getDictionary } from '../../i18n/dictionaries';
import { hashIp } from '../../lib/aiGuide';
import { getBookingByPaymentId } from '../../lib/crm';
import { canOfferSignup, signUpForEmail } from '../../lib/marketing';
import type { D1Like } from '../../lib/db';

export const prerender = false;

// Optional "travel ideas by email" box on the booking confirmation page. The page never shows the full address, so
// the address comes from the booking itself, found through the same private cookie the page uses (set for /booking
// only, which is why this lives under /booking). The box must be ticked; the address is only subscribed after the
// confirmation email. Booking emails are separate and unaffected by this.

const PER_IP_PER_HOUR = 5;
const HOUR_MS = 3600_000;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  let body: Record<string, unknown> = {};
  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
  } catch {
    return json(400, { error: 'bad_request' });
  }
  if (body.consent !== true) return json(400, { error: 'consent_required' });

  const env = resolveEnv(locals);
  const db: D1Like | undefined = env.DB;
  if (!db) return json(503, { error: 'unavailable' });

  const paymentId = cookies.get('booking_ref')?.value;
  const booking = paymentId ? await getBookingByPaymentId(db, paymentId) : null;
  if (!booking?.traveler_email || booking.status === 'cancelled') return json(404, { error: 'not_found' });
  const locale = resolveLocale(new URL(request.url).searchParams, typeof body.locale === 'string' ? body.locale : undefined);

  try {
    const ipHash = await hashIp(request.headers.get('cf-connecting-ip') ?? 'unknown');
    const perIp = await db.prepare(`SELECT COUNT(*) AS n FROM lead_form_requests WHERE ip_hash = ? AND created_at > ?`).bind(ipHash, Date.now() - HOUR_MS).first<{ n: number }>();
    if ((perIp?.n ?? 0) >= PER_IP_PER_HOUR) return json(429, { error: 'rate_limited' });
    await db.prepare(`INSERT INTO lead_form_requests (ip_hash, created_at) VALUES (?, ?)`).bind(ipHash, Date.now()).run();

    // Same answer whatever we already know about this address, so the box cannot be used to probe it.
    if (await canOfferSignup(db, booking.traveler_email)) {
      await signUpForEmail(env, db, {
        email: booking.traveler_email,
        locale,
        page: '/booking/confirmation',
        formId: 'booking_confirmation',
        source: 'booking_confirmation',
        consentText: getDictionary(locale).bookingSignup.consent,
        ipHash,
        userAgent: request.headers.get('user-agent') ?? '',
      });
    }
    return json(200, { ok: true });
  } catch (err) {
    console.error('booking subscribe failed', err instanceof Error ? err.message : 'error');
    return json(500, { error: 'failed' });
  }
};
