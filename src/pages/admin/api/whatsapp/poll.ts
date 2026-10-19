import type { APIRoute } from 'astro';
import { resolveEnv } from '../../../../lib/env';
import { isAdminAuthenticated } from '../../../../lib/requireAdmin';
import { inboxSignature } from '../../../../lib/waInbox';

export const prerender = false;

// Polled every few seconds by the open WhatsApp page; returns only a fingerprint, never message text.
export const GET: APIRoute = async ({ locals, cookies }) => {
  const env = resolveEnv(locals);
  if (!(await isAdminAuthenticated(cookies, env.ADMIN_SESSION_SECRET))) return new Response('Unauthorized', { status: 401 });
  if (!env.DB) return new Response(JSON.stringify({ sig: '' }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  const sig = await inboxSignature(env.DB);
  return new Response(JSON.stringify({ sig }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
};
