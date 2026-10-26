import type { APIRoute } from 'astro';
import { resolveEnv } from '../../../../lib/env';
import { isAdminAuthenticated } from '../../../../lib/requireAdmin';
import { getBookingById } from '../../../../lib/crm';

export const prerender = false;

// Admin-only download of a booking's uploaded e-ticket. E-tickets live under
// the private tickets/ prefix, which the public /images route refuses to serve.
export const GET: APIRoute = async ({ params, locals, cookies }) => {
  const env = resolveEnv(locals);
  if (!(await isAdminAuthenticated(cookies, env.ADMIN_SESSION_SECRET, locals))) {
    return new Response('Not found', { status: 404 });
  }
  const db = env.DB;
  const r2 = env.IMAGES;
  if (!db || !r2 || !params.id) return new Response('Not found', { status: 404 });

  const booking = await getBookingById(db, params.id);
  const key = booking?.ticket_file_key;
  if (!key || !key.startsWith('tickets/')) return new Response('Not found', { status: 404 });

  const object = await r2.get(key);
  if (!object) return new Response('Not found', { status: 404 });

  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'Content-Disposition': `attachment; filename="entry-tickets-${booking.travel_date}.${key.split('.').pop()}"`,
      'Cache-Control': 'private, no-store',
    },
  });
};
