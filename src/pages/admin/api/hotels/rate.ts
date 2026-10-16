import type { APIRoute } from 'astro';
import { resolveEnv } from '../../../../lib/env';
import { resolveCurrency } from '../../../../lib/currency';
import { rateHotel } from '../../../../lib/hotelQuote';
import { isAdminAuthenticated } from '../../../../lib/requireAdmin';

export const prerender = false;

// Admin-only copy of /api/hotels/rate for the test page (works while hotels are off).
export const POST: APIRoute = async ({ request, locals, url, cookies }) => {
  const env = resolveEnv(locals);
  if (!(await isAdminAuthenticated(cookies, env.ADMIN_SESSION_SECRET))) return new Response('Unauthorized', { status: 401 });
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // Handled as a bad request by the service.
  }
  try {
    const currency = resolveCurrency(url.searchParams, cookies.get('currency')?.value);
    const result = await rateHotel(env, env.DB, body, currency, new Date(), true);
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'Content-Type': 'application/json' } });
  } catch (error: any) {
    console.error('admin hotel rate error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
