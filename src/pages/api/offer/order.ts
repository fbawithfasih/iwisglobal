import type { APIRoute } from 'astro';
import { resolveEnv } from '../../../lib/env';
import { handleOfferOrder } from '../../../lib/offerPayment';

export const prerender = false;

// Start (or resume) a payment on a private offer: the server works out the
// amount from the stored offer and opens (or reuses) the Razorpay order.
// See src/lib/offerPayment.ts.
export const POST: APIRoute = async ({ request, locals }) => {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // Handled as a bad request by the service.
  }
  try {
    const env = resolveEnv(locals);
    const result = await handleOfferOrder(env, env.DB, body);
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'Content-Type': 'application/json' } });
  } catch (error: unknown) {
    console.error('offer order error:', error instanceof Error ? error.message : 'error');
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
