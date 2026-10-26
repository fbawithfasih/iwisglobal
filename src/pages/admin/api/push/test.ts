import type { APIRoute } from 'astro';
import { resolveEnv } from '../../../../lib/env';
import { isAdminAuthenticated } from '../../../../lib/requireAdmin';
import { sendAdminPush } from '../../../../lib/webPush';

export const prerender = false;

// "Send test alert" button on /admin/whatsapp: pushes a harmless message to every saved device.
export const POST: APIRoute = async ({ locals, cookies }) => {
  const env = resolveEnv(locals);
  if (!(await isAdminAuthenticated(cookies, env.ADMIN_SESSION_SECRET, locals))) return new Response('Unauthorized', { status: 401 });
  if (!env.DB) return new Response(JSON.stringify({ error: 'No database' }), { status: 500 });
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    return new Response(JSON.stringify({ error: 'The VAPID keys are not set in Cloudflare yet.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  const sent = await sendAdminPush(env, env.DB, {
    title: 'IWIS Admin: test alert',
    body: 'If you can read this, phone alerts work.',
    url: '/admin/whatsapp',
    tag: 'test',
  });
  return new Response(JSON.stringify({ sent }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
