import type { APIRoute } from 'astro';
import { resolveEnv } from '../../../lib/env';
import { resolveCurrency } from '../../../lib/currency';
import { todayIst } from '../../../lib/availability';
import { searchHotels } from '../../../lib/hotelSearchService';
import { isAdminAuthenticated } from '../../../lib/requireAdmin';

export const prerender = false;

// Hotel search. The browser sends dates and who is travelling; everything is
// re-validated, priced and cached for the booking step in
// src/lib/hotelSearchService.ts.
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
    const result = await searchHotels(env, env.DB, body, currency, todayIst(), new Date(), admin);
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'Content-Type': 'application/json' } });
  } catch (error: any) {
    console.error('hotel search error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
