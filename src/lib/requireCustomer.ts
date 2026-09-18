import type { AstroCookies } from 'astro';
import { verifyCustomerSessionToken } from './customerAuth';

export const CUSTOMER_COOKIE = 'customer_session';
export const OAUTH_STATE_COOKIE = 'oauth_state';

// Returns the signed-in customer's id, or null if there's no valid session.
export async function getSessionCustomerId(cookies: AstroCookies, sessionSecret: string | undefined): Promise<string | null> {
  if (!sessionSecret) return null;
  const token = cookies.get(CUSTOMER_COOKIE)?.value;
  return verifyCustomerSessionToken(token, sessionSecret);
}
