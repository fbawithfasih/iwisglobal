import { META_GRAPH_VERSION } from './meta';

// Meta Conversions API: the server sends the same Purchase and Lead events the browser's Meta Pixel sends, so Meta
// still counts a conversion when the browser could not (ad blockers, Safari's tracking limits, a page lost after
// paying). Each event carries the same event_id as the browser's copy, so Meta counts it once.
//
// Only for visitors who accepted cookies: the cookie banner (CookieConsent.astro) is the consent for Meta
// measurement, and a server-side copy is no exception. Without consent, nothing is sent.
//
// Settings (Cloudflare Pages): META_CAPI_TOKEN (Events Manager, the dataset, Settings, Conversions API,
// Generate access token), optional META_PIXEL_ID (defaults to the site's pixel) and META_CAPI_TEST_CODE (Events
// Manager, Test events) while checking it works. Without the token this does nothing.

export const DEFAULT_PIXEL_ID = '179602460825688';

// What the browser sent with the request, kept only for a visitor who accepted cookies.
export interface MetaContext {
  consent: boolean;
  fbp: string;
  fbc: string;
  ip: string;
  userAgent: string;
}

export const NO_CONSENT: MetaContext = { consent: false, fbp: '', fbc: '', ip: '', userAgent: '' };

// Reads consent and Meta's own first-party cookies from a request (a create-order or enquiry call).
export function metaContextFromRequest(request: Request): MetaContext {
  const cookie = request.headers.get('cookie') ?? '';
  const get = (name: string) => decodeURIComponent(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(cookie)?.[1] ?? '');
  if (get('cookie_consent') !== 'granted') return NO_CONSENT;
  return {
    consent: true,
    fbp: get('_fbp').slice(0, 120),
    fbc: get('_fbc').slice(0, 300),
    ip: (request.headers.get('cf-connecting-ip') ?? '').slice(0, 45),
    userAgent: (request.headers.get('user-agent') ?? '').slice(0, 400),
  };
}

async function sha256(value: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Meta's normalisation rules: trimmed lower-case email; phone as digits only with the country code.
export const normEmail = (v: string): string => v.trim().toLowerCase();
export const normPhone = (v: string): string => v.replace(/\D/g, '').replace(/^00/, '');
const normName = (v: string): string => v.trim().toLowerCase().replace(/[^\p{L}\p{M}]/gu, '');

export interface MetaEvent {
  name: 'Purchase' | 'Lead' | 'InitiateCheckout';
  eventId: string;
  sourceUrl: string;
  email?: string;
  phone?: string;
  fullName?: string;
  value?: number; // major units
  currency?: string;
  contentIds?: string[];
  numItems?: number;
}

export async function buildPayload(e: MetaEvent, ctx: MetaContext, nowSeconds = Math.floor(Date.now() / 1000)): Promise<Record<string, unknown>> {
  const user: Record<string, unknown> = {};
  if (e.email && normEmail(e.email).includes('@')) user.em = [await sha256(normEmail(e.email))];
  if (e.phone && normPhone(e.phone).length >= 8) user.ph = [await sha256(normPhone(e.phone))];
  const parts = (e.fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length > 0 && normName(parts[0])) user.fn = [await sha256(normName(parts[0]))];
  if (parts.length > 1 && normName(parts[parts.length - 1])) user.ln = [await sha256(normName(parts[parts.length - 1]))];
  if (ctx.ip) user.client_ip_address = ctx.ip;
  if (ctx.userAgent) user.client_user_agent = ctx.userAgent;
  if (ctx.fbp) user.fbp = ctx.fbp;
  if (ctx.fbc) user.fbc = ctx.fbc;
  const custom: Record<string, unknown> = {};
  if (e.value != null) custom.value = Math.round(e.value * 100) / 100;
  if (e.currency) custom.currency = e.currency;
  if (e.contentIds?.length) {
    custom.content_ids = e.contentIds;
    custom.content_type = 'product';
  }
  if (e.numItems) custom.num_items = e.numItems;
  return {
    event_name: e.name,
    event_time: nowSeconds,
    event_id: e.eventId,
    action_source: 'website',
    event_source_url: e.sourceUrl,
    user_data: user,
    custom_data: custom,
  };
}

// Sends one event. Never throws and never blocks a booking: returns whether Meta accepted it.
export async function sendMetaEvent(env: Record<string, any>, e: MetaEvent, ctx: MetaContext): Promise<boolean> {
  if (!env.META_CAPI_TOKEN || !ctx.consent) return false;
  try {
    const pixel = String(env.META_PIXEL_ID || DEFAULT_PIXEL_ID);
    const body: Record<string, unknown> = { data: [await buildPayload(e, ctx)] };
    if (env.META_CAPI_TEST_CODE) body.test_event_code = String(env.META_CAPI_TEST_CODE);
    const res = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(pixel)}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.META_CAPI_TOKEN}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const err: any = await res.json().catch(() => ({}));
      console.error('meta capi: event refused', e.name, res.status, String(err?.error?.message ?? '').slice(0, 200));
      return false;
    }
    return true;
  } catch (err) {
    console.error('meta capi: send failed', e.name, err instanceof Error ? err.message : 'error');
    return false;
  }
}
