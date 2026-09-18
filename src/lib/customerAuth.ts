// Signed session cookie for customer accounts (Google/Apple SSO — see
// src/lib/oauth/*.ts). Separate secret and cookie from the single-admin
// session in adminAuth.ts. No server-side session store: the token carries
// the customer id plus an expiry, HMAC-signed with CUSTOMER_SESSION_SECRET.

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — a consumer session, not admin

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// customerId is always a `cust_<uuid>` string (see createCustomer in
// customers.ts) so it never contains the '.' used as the token separator.
export async function createCustomerSessionToken(customerId: string, secret: string): Promise<string> {
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = `${customerId}.${exp}`;
  const sig = await hmacHex(secret, payload);
  return `${payload}.${sig}`;
}

// Returns the customer id the token was issued for, or null if missing,
// malformed, expired, or forged.
export async function verifyCustomerSessionToken(token: string | undefined, secret: string): Promise<string | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [customerId, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!customerId || !Number.isFinite(exp) || exp < Date.now()) return null;
  const expectedSig = await hmacHex(secret, `${customerId}.${expStr}`);
  return timingSafeEqual(sig, expectedSig) ? customerId : null;
}
