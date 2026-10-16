import type { APIRoute } from 'astro';
import { resolveEnv } from '../../../lib/env';
import { resolveCurrency } from '../../../lib/currency';
import { rateHotel } from '../../../lib/hotelQuote';
import { isAdminAuthenticated } from '../../../lib/requireAdmin';

export const prerender = false;

// Pick a rate from a search: re-check it with Hotelbeds when needed, price it
// on the server and store the quote. See src/lib/hotelQuote.ts.
export const POST: APIRoute = async ({ request, locals, url, cookies }) => {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // Handled as a bad request by the service.
  }
  try {
    const env = resolveEnv(locals);
    const currency = resolveCurrency(url.searchParams, cookies.get('currency')?.value);
    const admin = await isAdminAuthenticated(cookies, env.ADMIN_SESSION_SECRET);
    const result = await rateHotel(env, env.DB, body, currency, new Date(), admin);
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'Content-Type': 'application/json' } });
  } catch (error: any) {
    console.error('hotel rate error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
