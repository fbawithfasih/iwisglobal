import type { APIRoute } from 'astro';
import { resolveEnv } from '../../../lib/env';
import { pollMeta } from '../../../lib/meta';

export const prerender = false;

// Safety net, called every 15 minutes by .github/workflows/meta-lead-poll.yml with the shared secret:
// retries failed Meta events and fetches recent leads a webhook never delivered.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = resolveEnv(locals);
  const sent = request.headers.get('authorization') ?? '';
  if (!env.META_POLL_SECRET || sent !== `Bearer ${env.META_POLL_SECRET}` || !env.DB) {
    return new Response('Not found', { status: 404 });
  }
  try {
    const result = await pollMeta(env, env.DB);
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('meta poll failed', err instanceof Error ? err.message : 'error');
    return new Response(JSON.stringify({ error: 'failed' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }
};
