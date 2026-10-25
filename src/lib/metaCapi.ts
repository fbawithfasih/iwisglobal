import { META_GRAPH_VERSION } from './meta';
import { effectiveConsent, requestCountry } from './consentRegion';

// Meta Conversions API: the server sends the same Purchase and Lead events the browser's Meta Pixel sends, so Meta
// still counts a conversion when the browser could not (ad blockers, Safari's tracking limits, a page lost after
// paying). Each event carries the same event_id as the browser's copy, so Meta counts it once.
//
// Only with consent, exactly as for the browser's pixel: in the EU/EEA, UK and Switzerland only after the visitor
// tapped Accept; elsewhere unless they switched it off with "Cookie settings" (src/lib/consentRegion.ts).
//
// Settings (Cloudflare Pages): META_CAPI_TOKEN (Events Manager, the dataset, Settings, Conversions API,
// Generate access token), optional META_PIXEL_ID (defaults to the site's pixel) and META_CAPI_TEST_CODE (Events
// Manager, Test events) while checking it works. Without META_CAPI_TOKEN the leads system-user token
// (META_PAGE_ACCESS_TOKEN) is tried instead: it works once that system user is given the dataset in Business
// Settings and the token has ads_management. testMetaCapi below says which. With neither token this does nothing.

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
  if (effectiveConsent(cookie, requestCountry(request)) !== 'granted') return NO_CONSENT;
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

// The token events are sent with: the dedicated one, else the leads system-user token.
export function capiToken(env: Record<string, any>): { token: string; source: 'own' | 'leads' | 'none' } {
  if (env.META_CAPI_TOKEN) return { token: String(env.META_CAPI_TOKEN), source: 'own' };
  if (env.META_PAGE_ACCESS_TOKEN) return { token: String(env.META_PAGE_ACCESS_TOKEN), source: 'leads' };
  return { token: '', source: 'none' };
}

// Sends one event. Never throws and never blocks a booking: returns whether Meta accepted it.
export async function sendMetaEvent(env: Record<string, any>, e: MetaEvent, ctx: MetaContext): Promise<boolean> {
  const { token } = capiToken(env);
  if (!token || !ctx.consent) return false;
  try {
    const pixel = String(env.META_PIXEL_ID || DEFAULT_PIXEL_ID);
    const body: Record<string, unknown> = { data: [await buildPayload(e, ctx)] };
    if (env.META_CAPI_TEST_CODE) body.test_event_code = String(env.META_CAPI_TEST_CODE);
    const res = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(pixel)}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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

type FetchFn = typeof fetch;

async function graphJson(fetchFn: FetchFn, url: string, init: RequestInit): Promise<{ ok: boolean; data: any; error: string }> {
  try {
    const res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(8000) });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, data, error: `(#${data?.error?.code ?? res.status}) ${String(data?.error?.message ?? 'error').slice(0, 200)}` };
    return { ok: true, data, error: '' };
  } catch {
    return { ok: false, data: null, error: 'network error' };
  }
}

// Plain-language check for the admin page: which token is used, whether it can reach the dataset, and, only with a
// test code, whether Meta accepts an event (it then shows under Events Manager, Test events, and counts nowhere
// else). Without a test code nothing is sent, so a check never adds a fake Lead to the real figures. Never returns a token.
export async function testMetaCapi(env: Record<string, any>, testCode: string, ctx: { ip: string; userAgent: string }, fetchFn: FetchFn = fetch): Promise<string[]> {
  const out: string[] = [];
  const { token, source } = capiToken(env);
  const pixel = String(env.META_PIXEL_ID || DEFAULT_PIXEL_ID);
  if (!token) return ['No token: neither META_CAPI_TOKEN nor META_PAGE_ACCESS_TOKEN is set, so nothing is sent to Meta.'];
  out.push(source === 'own'
    ? 'Token used: META_CAPI_TOKEN (the dedicated Conversions API token).'
    : 'Token used: META_PAGE_ACCESS_TOKEN (the leads system-user token), because META_CAPI_TOKEN is not set.');
  const auth = { Authorization: `Bearer ${token}` };
  const base = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

  if (source === 'leads') {
    const perms = await graphJson(fetchFn, `${base}/me/permissions`, { headers: auth });
    if (perms.ok) {
      const granted = (perms.data?.data ?? []).filter((p: any) => p.status === 'granted').map((p: any) => p.permission);
      out.push(`ads_management ${granted.includes('ads_management') ? 'is' : 'is NOT'} among the token's permissions${granted.includes('ads_management') ? '.' : ' (needed to send events with a system-user token).'}`);
    } else out.push(`Permissions could not be listed: ${perms.error}`);
  }

  const ds = await graphJson(fetchFn, `${base}/${encodeURIComponent(pixel)}?fields=id,name,last_fired_time`, { headers: auth });
  out.push(ds.ok
    ? `Dataset ${pixel} is reachable: ${ds.data?.name ?? '?'}${ds.data?.last_fired_time ? `, last event ${ds.data.last_fired_time}` : ''}.`
    : `Dataset ${pixel} is NOT reachable with this token: ${ds.error}`);

  const code = testCode || String(env.META_CAPI_TEST_CODE ?? '');
  if (!code) {
    out.push('No test event sent: enter the code from Events Manager, Test events, to send one.');
    return out;
  }
  const event = await buildPayload(
    { name: 'Lead', eventId: `capi_test_${Date.now()}`, sourceUrl: 'https://www.iwisglobal.com/contact', email: 'capi-test@iwisglobal.com' },
    { consent: true, fbp: '', fbc: '', ip: ctx.ip, userAgent: ctx.userAgent || 'iwis-admin-capi-test' },
  );
  const sent = await graphJson(fetchFn, `${base}/${encodeURIComponent(pixel)}/events`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: [event], test_event_code: code }),
  });
  out.push(sent.ok
    ? `Test Lead accepted by Meta (events received: ${sent.data?.events_received ?? '?'}). It shows in Events Manager, Test events, as from Server.`
    : `Test Lead refused: ${sent.error}`);
  if (!sent.ok && source === 'leads') out.push('Fix: in Business Settings, Data sources, Datasets, open the pixel, Assign people, add the iwis-leads system user with full control; if ads_management is missing, generate its token again with ads_management ticked and replace META_PAGE_ACCESS_TOKEN. Or create a dedicated token (runbook, Conversions API).');
  return out;
}
