import type { APIRoute } from 'astro';
import { resolveEnv } from '../../../lib/env';
import { handleVerify } from '../../../lib/customTripPayment';

export const prerender = false;

// Called by the browser once Razorpay reports a successful payment. Verifies
// the signature, reads the order back from Razorpay and records the booking
// (src/lib/customTripPayment.ts). Safe to call twice for the same payment.
export const POST: APIRoute = async ({ request, locals }) => {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // Handled as a bad request below.
  }
  try {
    const env = resolveEnv(locals);
    const result = await handleVerify(env, env.DB, body);
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'Content-Type': 'application/json' } });
  } catch (error: any) {
    console.error('custom-trip verify error:', error);
    return new Response(JSON.stringify({ error: error?.message || 'Internal server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
