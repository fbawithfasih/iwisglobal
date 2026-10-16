import type { APIRoute } from 'astro';
import { resolveEnv } from '../../../lib/env';
import { handleHotelOrder } from '../../../lib/hotelPayment';

export const prerender = false;

// Start payment for a quoted hotel booking: validate the guests and open (or
// reuse) the Razorpay order. See src/lib/hotelPayment.ts.
export const POST: APIRoute = async ({ request, locals }) => {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // Handled as a bad request by the service.
  }
  try {
    const env = resolveEnv(locals);
    const result = await handleHotelOrder(env, env.DB, body);
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'Content-Type': 'application/json' } });
  } catch (error: any) {
    console.error('hotel order error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
