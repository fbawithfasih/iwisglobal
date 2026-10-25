import type { APIRoute } from 'astro';
import { resolveEnv } from '../../lib/env';
import { effectiveConsent, requestCountry } from '../../lib/consentRegion';
import { OFFER_TIMER_COOKIE, OFFER_TIMER_MAX_AGE_S, signTimer, timerSecret, verifyTimer } from '../../lib/offerTimer';

export const prerender = false;

// Starts (once per browser) or reports the visitor's clock for countdown offers
// (src/lib/offerTimer.ts). Called by the booking widget on a tour page that has
// one. Refuses without cookie consent where it is needed, so in the EU/EEA, UK
// and Switzerland nothing is stored until the visitor taps Accept.
export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  const env = resolveEnv(locals);
  const secret = timerSecret(env);
  if (!secret) return json({ ok: false, reason: 'unavailable' }, 503);

  const cf = (locals as { runtime?: { cf?: { country?: string } } }).runtime?.cf;
  if (effectiveConsent(request.headers.get('cookie') ?? '', requestCountry(request, cf)) !== 'granted') {
    return json({ ok: false, reason: 'consent' });
  }

  const now = Date.now();
  const existing = await verifyTimer(secret, cookies.get(OFFER_TIMER_COOKIE)?.value, now);
  if (existing) return json({ ok: true, startedAt: existing, now });

  cookies.set(OFFER_TIMER_COOKIE, await signTimer(secret, now), {
    path: '/',
    maxAge: OFFER_TIMER_MAX_AGE_S,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
  });
  return json({ ok: true, startedAt: now, now });
};
