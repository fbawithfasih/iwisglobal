import type { APIRoute } from 'astro';
import { resolveEnv } from '../../../lib/env';
import { syncHotelContent } from '../../../lib/hotelContent';

export const prerender = false;

// Weekly refresh, called by .github/workflows/hotel-content-sync.yml with the
// shared secret in the Authorization header. Hotelbeds requires content to be
// refreshed at least weekly.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = resolveEnv(locals);
  const sent = request.headers.get('authorization') ?? '';
  if (!env.HOTEL_SYNC_SECRET || sent !== `Bearer ${env.HOTEL_SYNC_SECRET}` || !env.DB) {
    return new Response('Not found', { status: 404 });
  }
  const result = await syncHotelContent(env, env.DB);
  return new Response(JSON.stringify(result), { status: result.ok ? 200 : 502, headers: { 'Content-Type': 'application/json' } });
};
