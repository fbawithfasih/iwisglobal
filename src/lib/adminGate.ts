// The single gate in front of every /admin page and API (second layer: each route still checks for itself, see
// scripts/contacts-test/route-inventory.ts). It works out who is calling (the owner password cookie, or a staff
// Google session), refuses anyone who is not signed in, refuses staff on owner-only pages, and puts the person on
// context.locals.admin for the page and for the audit log.
import { normalisePath } from './blockedPaths';
import { adminCookieValid } from './requireAdmin';
import { canAccessPath, ownerPrincipal, type Principal } from './authz';
import { resolveStaffSession, STAFF_COOKIE } from './staff';
import type { D1Like } from './db';

// Pages that must stay reachable without a session: signing in and out, and the Google sign-in hand-off.
const OPEN_SECTIONS = new Set(['login', 'logout', 'auth']);

type Ctx = {
  url: URL;
  request: Request;
  cookies: { get(name: string): { value: string } | undefined };
  locals: object;
};

const NO_STORE = { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' };

/** Returns a response to send instead of the page, or null to carry on. */
export async function adminGate(context: Ctx, env: Record<string, any>): Promise<Response | null> {
  const parts = normalisePath(context.url.pathname);
  if (parts[0] !== 'admin') return null;
  if (parts[1] && OPEN_SECTIONS.has(parts[1])) return null;

  let principal: Principal | null = null;
  if (await adminCookieValid(context.cookies.get('admin_session')?.value, env.ADMIN_SESSION_SECRET)) {
    principal = ownerPrincipal();
  } else if (env.DB) {
    try {
      principal = await resolveStaffSession(env.DB as D1Like, context.cookies.get(STAFF_COOKIE)?.value);
    } catch (err) {
      // Staff tables not created yet (or a database error): no staff session can be valid. The owner cookie still works.
      console.error('staff session lookup failed', err instanceof Error ? err.message : 'error');
    }
  }

  if (!principal) {
    const read = context.request.method === 'GET' || context.request.method === 'HEAD';
    if (read && parts[1] !== 'api') return new Response(null, { status: 302, headers: { Location: '/admin/login', 'Cache-Control': 'no-store' } });
    return new Response('Unauthorized', { status: 401, headers: NO_STORE });
  }

  (context.locals as { admin?: Principal }).admin = principal;
  if (!canAccessPath(principal, context.url.pathname)) {
    return new Response('This page is only for the owner.', { status: 403, headers: NO_STORE });
  }
  return null;
}
