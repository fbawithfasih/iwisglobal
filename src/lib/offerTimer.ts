// The visitor's clock for countdown offers (offers.window_minutes): started the
// first time they open a tour page that has one, and never restarted in that
// browser, so "book within 30 minutes" is a real limit, not a timer that resets
// on every visit (India's dark-pattern guidelines prohibit false urgency).
//
// The start time lives in a signed first-party cookie, set by /api/offer-timer
// only when the visitor's cookie choice allows it (src/lib/consentRegion.ts:
// after Accept in the EU/EEA, UK and Switzerland). create-order reads the cookie
// again and decides the discount itself; the browser's countdown is display only.
export const OFFER_TIMER_COOKIE = 'offer_timer';
// Kept for 90 days, so the same browser doesn't get a fresh 30 minutes on its next visit.
export const OFFER_TIMER_MAX_AGE_S = 90 * 24 * 60 * 60;
// Allowed past the countdown at create-order, for a Pay click made in the last seconds.
export const OFFER_TIMER_GRACE_MS = 2 * 60 * 1000;

async function hmac(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`offer-timer|${message}`));
  return Array.from(new Uint8Array(sig).slice(0, 16))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function signTimer(secret: string, startedAt: number): Promise<string> {
  return `${startedAt}.${await hmac(secret, String(startedAt))}`;
}

// The start time (ms) from a cookie value, or null if it is missing, forged, or in the future.
export async function verifyTimer(secret: string | undefined, value: string | undefined | null, nowMs = Date.now()): Promise<number | null> {
  if (!secret || !value) return null;
  const m = /^(\d{13})\.([0-9a-f]{32})$/.exec(value);
  if (!m) return null;
  const startedAt = Number(m[1]);
  if (startedAt > nowMs + 60_000) return null;
  const expected = await hmac(secret, m[1]);
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ m[2].charCodeAt(i);
  return diff === 0 ? startedAt : null;
}

// The cookie's value from a Cookie header.
export function timerCookieFrom(cookieHeader: string | null | undefined): string | null {
  return new RegExp(`(?:^|;\\s*)${OFFER_TIMER_COOKIE}=([^;]+)`).exec(cookieHeader ?? '')?.[1] ?? null;
}

// The secret: a dedicated OFFER_TIMER_SECRET if set, else the admin session secret (the HMAC input is
// prefixed "offer-timer|", so a timer signature can never stand in for anything else).
export const timerSecret = (env: Record<string, any>): string | undefined => env.OFFER_TIMER_SECRET || env.ADMIN_SESSION_SECRET || undefined;
