import type { AstroCookies } from 'astro';
import { verifySessionToken } from './adminAuth';

export const ADMIN_COOKIE = 'admin_session';

// Returns true if the request carries a valid, unexpired admin session
// cookie. Callers redirect to /admin/login when this is false.
export async function isAdminAuthenticated(cookies: AstroCookies, sessionSecret: string | undefined): Promise<boolean> {
  if (!sessionSecret) return false;
  const token = cookies.get(ADMIN_COOKIE)?.value;
  return verifySessionToken(token, sessionSecret);
}
