// Single-admin password auth for /admin/*, built on Web Crypto (available in
// the Cloudflare Workers runtime — no external auth library needed for one
// account). The password is never stored in plaintext: only a PBKDF2 hash +
// salt (ADMIN_PASSWORD_HASH / ADMIN_PASSWORD_SALT, both hex, set as
// Cloudflare secrets). Sessions are a signed, expiring cookie (HMAC-SHA256
// over the expiry with ADMIN_SESSION_SECRET) — no server-side session store
// needed for a single admin.
//
// Password hashing itself (PBKDF2 + its 100k-iteration ceiling) lives in
// passwordHash.ts, shared with customer email/password accounts.

import { toHex, timingSafeEqual } from './passwordHash';

export { hashPassword, generateSaltHex, verifyPassword } from './passwordHash';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return toHex(sig);
}

export async function createSessionToken(secret: string): Promise<string> {
  const exp = Date.now() + SESSION_TTL_MS;
  const sig = await hmacHex(secret, String(exp));
  return `${exp}.${sig}`;
}

export async function verifySessionToken(token: string | undefined, secret: string): Promise<boolean> {
  if (!token) return false;
  const [expStr, sig] = token.split('.');
  if (!expStr || !sig) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expectedSig = await hmacHex(secret, expStr);
  return timingSafeEqual(sig, expectedSig);
}
