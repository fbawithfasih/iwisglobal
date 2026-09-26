import type { AstroCookies } from 'astro';
import { verifyCustomerSessionToken } from './customerAuth';

export const CUSTOMER_COOKIE = 'customer_session';
export const OAUTH_STATE_COOKIE = 'oauth_state';

export const DEFAULT_AFTER_SIGN_IN = '/account/bookings';

// Where to send someone after sign-in/sign-up, from a ?redirect= value.
// Only paths on this site are allowed: a full URL, or "//host" / "/\host"
// (which browsers treat as another site), would let a link to our real
// sign-in page forward the visitor to a lookalike site afterwards. Control
// characters are refused too, since browsers strip tabs/newlines ("/\t/x"
// becomes "//x").
export function safeRedirectPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return DEFAULT_AFTER_SIGN_IN;
  if (/[\u0000-\u001f\\]/.test(value)) return DEFAULT_AFTER_SIGN_IN;
  return value;
}

// Returns the signed-in customer's id, or null if there's no valid session.
export async function getSessionCustomerId(cookies: AstroCookies, sessionSecret: string | undefined): Promise<string | null> {
  if (!sessionSecret) return null;
  const token = cookies.get(CUSTOMER_COOKIE)?.value;
  return verifyCustomerSessionToken(token, sessionSecret);
}
