import type { APIRoute } from 'astro';
import { resolveEnv } from '../../../../lib/env';
import { handleHotelOrder } from '../../../../lib/hotelPayment';
import { isAdminAuthenticated } from '../../../../lib/requireAdmin';

export const prerender = false;

// Admin-only copy of /api/hotels/order for the test page (works while hotels are off).
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
    const result = await handleHotelOrder(env, env.DB, body, new Date(), true);
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'Content-Type': 'application/json' } });
  } catch (error: any) {
    console.error('admin hotel order error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
