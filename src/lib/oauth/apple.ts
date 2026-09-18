// Apple "Sign in with Apple" (server-side authorization-code flow).
// Requires a paid Apple Developer account: a Services ID (APPLE_CLIENT_ID),
// your Team ID (APPLE_TEAM_ID), a Sign in with Apple key's Key ID
// (APPLE_KEY_ID), and that key's private key contents (APPLE_PRIVATE_KEY,
// the .p8 file's PEM text). Unlike Google, Apple's client_secret isn't a
// fixed string you copy in — it's a JWT you sign yourself with that
// private key. buildAppleClientSecret mints one fresh on every token
// exchange rather than caching a longer-lived one, trading a slightly
// slower token exchange for not having to manage secret rotation.

import { decodeJwtPayload, type OAuthProfile } from './shared';

function base64UrlEncodeBytes(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const b of arr) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlEncodeString(s: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(s));
}

async function importApplePrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s+/g, '');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return crypto.subtle.importKey('pkcs8', bytes.buffer, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

async function buildAppleClientSecret(env: Record<string, unknown>): Promise<string> {
  const teamId = env.APPLE_TEAM_ID as string | undefined;
  const clientId = env.APPLE_CLIENT_ID as string | undefined;
  const keyId = env.APPLE_KEY_ID as string | undefined;
  const privateKeyPem = env.APPLE_PRIVATE_KEY as string | undefined;
  if (!teamId || !clientId || !keyId || !privateKeyPem) throw new Error('Apple sign-in is not configured.');

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', kid: keyId };
  const payload = { iss: teamId, iat: now, exp: now + 300, aud: 'https://appleid.apple.com', sub: clientId };

  const signingInput = `${base64UrlEncodeString(JSON.stringify(header))}.${base64UrlEncodeString(JSON.stringify(payload))}`;
  const key = await importApplePrivateKey(privateKeyPem);
  // Web Crypto's ECDSA signature is the raw (r || s) format JWS/ES256
  // expects — no DER-to-raw conversion needed, unlike most other libraries.
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64UrlEncodeBytes(signature)}`;
}

export function buildAppleAuthorizeUrl(env: Record<string, unknown>, redirectUri: string, state: string): string {
  const clientId = env.APPLE_CLIENT_ID as string | undefined;
  if (!clientId) throw new Error('Apple sign-in is not configured.');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    response_mode: 'form_post',
    scope: 'name email',
    state,
  });
  return `https://appleid.apple.com/auth/authorize?${params.toString()}`;
}

// `formUser` is Apple's one-time `user` form field (JSON with
// name.firstName/lastName) — only sent on the FIRST authorization, since
// Apple never returns the name in the id_token and won't resend this field
// on later sign-ins. If it's missing (a returning user), we fall back to
// the email as the display name rather than guessing.
export async function exchangeAppleCode(
  env: Record<string, unknown>,
  code: string,
  redirectUri: string,
  formUser?: string | null
): Promise<OAuthProfile> {
  const clientId = env.APPLE_CLIENT_ID as string | undefined;
  if (!clientId) throw new Error('Apple sign-in is not configured.');
  const clientSecret = await buildAppleClientSecret(env);

  const res = await fetch('https://appleid.apple.com/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error('Could not verify your Apple sign-in. Please try again.');
  const tokens: any = await res.json();
  const claims = decodeJwtPayload(tokens.id_token);

  let name = claims.email as string;
  if (formUser) {
    try {
      const parsed = JSON.parse(formUser);
      const first = parsed?.name?.firstName ?? '';
      const last = parsed?.name?.lastName ?? '';
      if (first || last) name = `${first} ${last}`.trim();
    } catch {
      // Unparsable — keep the email fallback.
    }
  }

  return { providerSub: claims.sub, email: claims.email, name, avatarUrl: null };
}
