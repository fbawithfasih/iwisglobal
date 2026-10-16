import type { APIRoute } from 'astro';
import { resolveEnv } from '../../../../lib/env';
import { resolveCurrency } from '../../../../lib/currency';
import { todayIst } from '../../../../lib/availability';
import { searchHotels } from '../../../../lib/hotelSearchService';
import { isAdminAuthenticated } from '../../../../lib/requireAdmin';

export const prerender = false;

// Admin-only copy of /api/hotels/search for the test page: it works while hotels
// are switched off. It lives under /admin because the admin sign-in cookie is
// only sent to /admin addresses.
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
    const result = await searchHotels(env, env.DB, body, currency, todayIst(), new Date(), true);
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'Content-Type': 'application/json' } });
  } catch (error: any) {
    console.error('admin hotel search error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
