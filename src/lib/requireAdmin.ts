import type { AstroCookies } from 'astro';
import { verifySessionToken } from './adminAuth';
import type { Principal } from './authz';

export const ADMIN_COOKIE = 'admin_session';

/** True if the owner-password cookie is valid and unexpired. */
export async function adminCookieValid(token: string | undefined, sessionSecret: string | undefined): Promise<boolean> {
  if (!sessionSecret) return false;
  return verifySessionToken(token, sessionSecret);
}

// Returns true if the request is signed in to the admin: either the middleware has already identified a person
// (locals.admin: the owner cookie or a staff Google session, see src/lib/adminGate.ts), or the request carries a valid,
// unexpired owner-password cookie. Callers redirect to /admin/login when this is false. Owner-only pages and actions
// then check the role (src/lib/authz.ts).
export async function isAdminAuthenticated(
  cookies: AstroCookies,
  sessionSecret: string | undefined,
  locals?: { admin?: Principal } | unknown
): Promise<boolean> {
  if ((locals as { admin?: Principal } | undefined)?.admin) return true;
  return adminCookieValid(cookies.get(ADMIN_COOKIE)?.value, sessionSecret);
}
