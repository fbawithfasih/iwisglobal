import type { APIRoute } from 'astro';
import { resolveEnv } from '../../../lib/env';
import { handleOrder } from '../../../lib/customTripPayment';

export const prerender = false;

// Opens the Razorpay order for a custom trip's deposit. The browser sends its
// selections and contact details; everything is re-validated and re-priced on
// the server (src/lib/customTripPayment.ts), and the browser's total is unused.
export const POST: APIRoute = async ({ request, locals }) => {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // Handled as a bad request below.
  }
  try {
    const env = resolveEnv(locals);
    const result = await handleOrder(env, env.DB, body);
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'Content-Type': 'application/json' } });
  } catch (error: any) {
    console.error('custom-trip order error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
