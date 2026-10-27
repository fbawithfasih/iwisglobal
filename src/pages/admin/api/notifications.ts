import type { APIRoute } from 'astro';
import { resolveEnv } from '../../../lib/env';
import { isAdminAuthenticated } from '../../../lib/requireAdmin';
import { actorLabel } from '../../../lib/authz';
import { loadNotifications } from '../../../lib/notifications';

export const prerender = false;

// Polled about once a minute by every open admin page (the bell in the shell). Counts and short labels only: no names,
// no message text. Never cached, so a count is never older than the request.
const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

export const GET: APIRoute = async ({ locals, cookies }) => {
  const env = resolveEnv(locals);
  if (!(await isAdminAuthenticated(cookies, env.ADMIN_SESSION_SECRET, locals))) return new Response('Unauthorized', { status: 401, headers: { 'Cache-Control': 'no-store' } });
  if (!env.DB) return new Response(JSON.stringify({ total: 0, items: [], failed: true }), { status: 200, headers: HEADERS });
  const result = await loadNotifications(env.DB, { me: actorLabel(locals.admin) });
  return new Response(JSON.stringify(result), { status: 200, headers: HEADERS });
};
