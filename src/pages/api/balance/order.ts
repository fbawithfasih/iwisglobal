import type { APIRoute } from 'astro';
import { resolveEnv } from '../../../lib/env';
import { handleBalanceOrder } from '../../../lib/balancePayment';

export const prerender = false;

// Open (or resume) the Razorpay order for a balance link.
// See src/lib/balancePayment.ts.
export const POST: APIRoute = async ({ request, locals }) => {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // Handled as a bad request by the service.
  }
  try {
    const env = resolveEnv(locals);
    const result = await handleBalanceOrder(env, env.DB, body);
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'Content-Type': 'application/json' } });
  } catch (error: unknown) {
    console.error('balance order error:', error instanceof Error ? error.message : 'error');
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
