import type { APIRoute } from 'astro';
import { resolveEnv } from '../../../../lib/env';
import { isAdminAuthenticated } from '../../../../lib/requireAdmin';
import { isPushEndpoint, b64uDecode } from '../../../../lib/webPush';

export const prerender = false;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Saves (POST) or removes (DELETE) this device's push subscription. Admin only: the
// admin cookie is limited to /admin, so this route lives under /admin/api.
export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const env = resolveEnv(locals);
  if (!(await isAdminAuthenticated(cookies, env.ADMIN_SESSION_SECRET, locals))) return json(401, { error: 'Unauthorized' });
  if (!env.DB) return json(500, { error: 'No database' });
  const body: any = await request.json().catch(() => null);
  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;
  try {
    if (!isPushEndpoint(endpoint) || b64uDecode(String(p256dh)).length !== 65 || b64uDecode(String(auth)).length !== 16) return json(400, { error: 'Invalid subscription' });
  } catch {
    return json(400, { error: 'Invalid subscription' });
  }
  await env.DB.prepare(
    `INSERT INTO admin_push_subscriptions (endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`
  )
    .bind(endpoint, p256dh, auth, new Date().toISOString())
    .run();
  return json(200, { ok: true });
};

export const DELETE: APIRoute = async ({ request, locals, cookies }) => {
  const env = resolveEnv(locals);
  if (!(await isAdminAuthenticated(cookies, env.ADMIN_SESSION_SECRET, locals))) return json(401, { error: 'Unauthorized' });
  const body: any = await request.json().catch(() => null);
  if (env.DB && typeof body?.endpoint === 'string') await env.DB.prepare(`DELETE FROM admin_push_subscriptions WHERE endpoint = ?`).bind(body.endpoint).run();
  return json(200, { ok: true });
};
