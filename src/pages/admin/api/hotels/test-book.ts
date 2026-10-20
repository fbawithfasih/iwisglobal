import type { APIRoute } from 'astro';
import { resolveEnv } from '../../../../lib/env';
import { handleHotelOrder } from '../../../../lib/hotelPayment';
import { isAdminAuthenticated } from '../../../../lib/requireAdmin';

export const prerender = false;

// Admin-only "book without payment" for the test page. Refused (403 live_server) unless the
// Hotelbeds base URL is the TEST server, so it can never make a free booking on the live one.
export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const env = resolveEnv(locals);
  if (!(await isAdminAuthenticated(cookies, env.ADMIN_SESSION_SECRET))) return new Response('Unauthorized', { status: 401 });
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // Handled as a bad request by the service.
  }
  try {
    const result = await handleHotelOrder(env, env.DB, body, new Date(), true, true);
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'Content-Type': 'application/json' } });
  } catch (error: any) {
    console.error('admin hotel test booking error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
