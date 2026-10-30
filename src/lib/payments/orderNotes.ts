// What a tour order carries in Razorpay's notes besides the booking itself: the guest's contact details and where
// they came from. Razorpay keeps the notes with the order, so the payment webhook can still create the booking
// (and send the emails) when the guest's browser never comes back after paying, for example when a UPI app takes
// over on a phone. Razorpay allows at most 15 keys of 256 characters each, so each object is packed into one key.
// A tour order uses up to 15 keys with every optional one present (offer, label, GA id): do not add another.

import type { MetaContext } from '../metaCapi';

const MAX_NOTE = 255;

export interface OrderGuest {
  name: string;
  email: string;
  phone: string;
  locale: string;
}

// The ad or campaign the visitor arrived from (first touch of the browsing session).
export interface OrderAttribution {
  source: string;
  medium: string;
  campaign: string;
  landingPage: string;
  gclid: string;
  fbclid: boolean;
}

const s = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');

// Shortens the longest field until the JSON fits in one note.
function pack(obj: Record<string, string | number>): string {
  const o = { ...obj };
  let out = JSON.stringify(o);
  while (out.length > MAX_NOTE) {
    const longest = Object.entries(o).filter(([, v]) => typeof v === 'string').sort((a, b) => String(b[1]).length - String(a[1]).length)[0];
    if (!longest || String(longest[1]).length === 0) break;
    o[longest[0]] = String(longest[1]).slice(0, Math.max(0, String(longest[1]).length - (out.length - MAX_NOTE) - 1));
    out = JSON.stringify(o);
  }
  return out.slice(0, MAX_NOTE);
}

const parse = (note: unknown): Record<string, unknown> => {
  if (typeof note !== 'string' || !note) return {};
  try {
    const v = JSON.parse(note);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
};

export function packGuest(g: Partial<OrderGuest> | undefined): string {
  return pack({ n: s(g?.name, 80), e: s(g?.email, 120), p: s(g?.phone, 30), l: s(g?.locale, 5) });
}

export function unpackGuest(note: unknown): OrderGuest {
  const v = parse(note);
  return { name: s(v.n, 80), email: s(v.e, 120), phone: s(v.p, 30), locale: s(v.l, 5) };
}

export function packAttribution(a: Partial<OrderAttribution> | undefined): string {
  return pack({ s: s(a?.source, 40), m: s(a?.medium, 40), c: s(a?.campaign, 60), lp: s(a?.landingPage, 80), g: s(a?.gclid, 120), f: a?.fbclid ? 1 : 0 });
}

export function unpackAttribution(note: unknown): OrderAttribution {
  const v = parse(note);
  return { source: s(v.s, 40), medium: s(v.m, 40), campaign: s(v.c, 60), landingPage: s(v.lp, 80), gclid: s(v.g, 120), fbclid: v.f === 1 };
}

// Reads the browser's first-touch record (BaseLayout's iwis_first_touch) from a request body, defensively.
export function attributionFromBody(v: unknown): OrderAttribution {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  return { source: s(o.source, 40), medium: s(o.medium, 40), campaign: s(o.campaign, 60), landingPage: s(o.landingPage, 80), gclid: s(o.gclid, 120), fbclid: !!s(o.fbclid, 500) };
}

// Consent and the browser identifiers for the Conversions APIs (src/lib/metaCapi.ts, src/lib/openaiCapi.ts). Only kept
// for a visitor who accepted cookies; otherwise the note says "no consent" and nothing is sent for this booking.
// OpenAI's click references (o, r) must reach OpenAI exactly as the pixel wrote them, so they are never shortened:
// one that cannot fit is dropped, and the longer, less important fields (browser string, then Meta's ids) give way first.
const MAX_OPPREF = 120;
const MAX_OBREF = 64;

export function packMeta(m: MetaContext | undefined): string {
  if (!m?.consent) return '{"k":0}';
  const o: Record<string, string | number> = { k: 1, b: s(m.fbp, 120), c: s(m.fbc, 300), i: s(m.ip, 45), u: s(m.userAgent, 400) };
  const oppref = s(m.oppref, 300);
  const obref = s(m.obref, 100);
  if (oppref && oppref.length <= MAX_OPPREF) o.o = oppref;
  if (obref && obref.length <= MAX_OBREF) o.r = obref;
  let out = JSON.stringify(o);
  for (const key of ['u', 'c', 'b', 'i']) {
    if (out.length <= MAX_NOTE) break;
    const over = out.length - MAX_NOTE;
    o[key] = String(o[key]).slice(0, Math.max(0, String(o[key]).length - over - 1));
    out = JSON.stringify(o);
  }
  return out.slice(0, MAX_NOTE);
}

export function unpackMeta(note: unknown): MetaContext {
  const v = parse(note);
  if (v.k !== 1) return { consent: false, fbp: '', fbc: '', ip: '', userAgent: '' };
  return { consent: true, fbp: s(v.b, 120), fbc: s(v.c, 300), ip: s(v.i, 45), userAgent: s(v.u, 400), oppref: s(v.o, MAX_OPPREF), obref: s(v.r, MAX_OBREF) };
}

// GA4's client id and session id share the gaClientId note ("<client id>|<session id>"), because the order has no
// spare key. The session id lets GA4 put the purchase in the visitor's session, so it is credited to the ad or
// search that brought them; without it the Measurement Protocol purchase lands in "Unassigned".
const GA_CLIENT = /^\d{1,20}\.\d{1,20}$/;
const GA_SESSION = /^\d{1,20}$/;

export function packGa(clientId: unknown, sessionId: unknown): string | undefined {
  if (typeof clientId !== 'string' || !GA_CLIENT.test(clientId)) return undefined;
  return typeof sessionId === 'string' && GA_SESSION.test(sessionId) ? `${clientId}|${sessionId}` : clientId;
}

export function unpackGa(note: unknown): { clientId: string; sessionId: string } {
  const [clientId = '', sessionId = ''] = typeof note === 'string' ? note.split('|') : [];
  return { clientId: GA_CLIENT.test(clientId) ? clientId : '', sessionId: GA_SESSION.test(sessionId) ? sessionId : '' };
}
