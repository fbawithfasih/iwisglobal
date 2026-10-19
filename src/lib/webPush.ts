// Web Push to the admin's phone, built on Web Crypto (available in the Cloudflare
// Workers runtime; the usual `web-push` package is not). Used to buzz the owner's
// Home Screen app when a WhatsApp chat needs a person (src/pages/api/webhooks/whatsapp.ts).
//
//   VAPID (RFC 8292)    identifies this site to the push service with a signed token
//   aes128gcm (RFC 8291) encrypts the message so only the device can read it
//
// Keys: scripts/vapid-keys.mjs prints VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, set
// as Cloudflare secrets. Subscriptions: schema_admin_push.sql. Sending never
// throws and never blocks the caller.
import type { D1Like } from './db';

const enc = new TextEncoder();

export const b64uEncode = (bytes: ArrayBuffer | Uint8Array): string => {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const b64uDecode = (text: string): Uint8Array<ArrayBuffer> => {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const concat = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(new ArrayBuffer(parts.reduce((n, p) => n + p.length, 0)));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, bytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

// RFC 8291 section 3: one record holding the whole message.
export async function encryptPayload(plaintext: Uint8Array<ArrayBuffer>, p256dh: string, authSecret: string): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = b64uDecode(p256dh);
  const auth = b64uDecode(authSecret);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4 || auth.length !== 16) throw new Error('bad subscription keys');

  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, pair.privateKey, 256));

  const prk = await hkdf(auth, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const cek = await hkdf(salt, prk, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, prk, enc.encode('Content-Encoding: nonce\0'), 12);

  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // 0x02 marks the last (and only) record.
  const record = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(plaintext, new Uint8Array([2]))));

  const header = new Uint8Array(new ArrayBuffer(21));
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096, false);
  header[20] = asPublic.length;
  return concat(header, asPublic, record);
}

// RFC 8292: a signed token the push service checks against our public key.
export async function vapidAuthorization(endpoint: string, publicKey: string, privateKey: string, subject: string, now: Date = new Date()): Promise<string> {
  const pub = b64uDecode(publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('bad VAPID public key');
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: privateKey, x: b64uEncode(pub.slice(1, 33)), y: b64uEncode(pub.slice(33, 65)) },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  const head = b64uEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64uEncode(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now.getTime() / 1000) + 12 * 3600, sub: subject })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${claims}`));
  return `vapid t=${head}.${claims}.${b64uEncode(sig)}, k=${publicKey}`;
}

// Only real push services are accepted, so a saved subscription can never make the
// server call an arbitrary address.
const PUSH_HOSTS = ['.push.apple.com', '.googleapis.com', '.push.services.mozilla.com', '.notify.windows.com'];
export function isPushEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 1000) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && PUSH_HOSTS.some((h) => u.hostname.endsWith(h));
  } catch {
    return false;
  }
}

export interface PushMessage {
  title: string;
  body: string;
  url: string; // opened when the notification is tapped
  tag?: string; // a newer message with the same tag replaces the older one
}

export interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function sendPush(env: Record<string, any>, sub: PushSubscriptionRow, message: PushMessage): Promise<{ ok: boolean; status: number; gone: boolean }> {
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return { ok: false, status: 0, gone: false };
  try {
    const body = await encryptPayload(enc.encode(JSON.stringify(message)), sub.p256dh, sub.auth);
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidAuthorization(sub.endpoint, publicKey, privateKey, 'mailto:info@iwisglobal.com'),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '86400',
        Urgency: 'high',
      },
      body,
    });
    return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
  } catch (err) {
    console.error('webPush: send failed', err);
    return { ok: false, status: 0, gone: false };
  }
}

// Sends to every saved device; a device the push service says is gone is removed.
// Returns how many accepted the message. Never throws.
export async function sendAdminPush(env: Record<string, any>, db: D1Like, message: PushMessage): Promise<number> {
  try {
    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return 0;
    const { results } = await db.prepare(`SELECT endpoint, p256dh, auth FROM admin_push_subscriptions`).bind().all<PushSubscriptionRow>();
    let sent = 0;
    for (const sub of results ?? []) {
      const r = await sendPush(env, sub, message);
      if (r.ok) sent += 1;
      else if (r.gone) await db.prepare(`DELETE FROM admin_push_subscriptions WHERE endpoint = ?`).bind(sub.endpoint).run();
    }
    return sent;
  } catch (err) {
    console.error('webPush: sendAdminPush failed', err);
    return 0;
  }
}
