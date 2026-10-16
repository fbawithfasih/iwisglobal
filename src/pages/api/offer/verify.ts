import type { APIRoute } from 'astro';
import { resolveEnv } from '../../../lib/env';
import { handleOfferVerify } from '../../../lib/offerPayment';

export const prerender = false;

// Called by the browser once Razorpay reports a successful payment. Verifies
// the signature, reads the order back from Razorpay and records the payment
// (src/lib/offerPayment.ts). Safe to call twice and to race the webhook.
export const POST: APIRoute = async ({ request, locals }) => {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // Handled as a bad request below.
  }
  try {
    const env = resolveEnv(locals);
    const result = await handleOfferVerify(env, env.DB, body);
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'Content-Type': 'application/json' } });
  } catch (error: unknown) {
    console.error('offer verify error:', error instanceof Error ? error.message : 'error');
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
