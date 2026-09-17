// Single-admin password auth for /admin/*, built on Web Crypto (available in
// the Cloudflare Workers runtime — no external auth library needed for one
// account). The password is never stored in plaintext: only a PBKDF2 hash +
// salt (ADMIN_PASSWORD_HASH / ADMIN_PASSWORD_SALT, both hex, set as
// Cloudflare secrets). Sessions are a signed, expiring cookie (HMAC-SHA256
// over the expiry with ADMIN_SESSION_SECRET) — no server-side session store
// needed for a single admin.

// Cloudflare Workers' PBKDF2 implementation caps iterations at 100,000
// (higher values throw NotSupportedError at runtime) — this is the max
// usable in this runtime, still well above older minimum-security baselines.
const PBKDF2_ITERATIONS = 100_000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function hashPassword(password: string, saltHex: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromHex(saltHex), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return toHex(bits);
}

export function generateSaltHex(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return toHex(bytes.buffer);
}

export async function verifyPassword(
  password: string,
  saltHex: string,
  expectedHashHex: string
): Promise<boolean> {
  const actual = await hashPassword(password, saltHex);
  return timingSafeEqual(actual, expectedHashHex);
}

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
