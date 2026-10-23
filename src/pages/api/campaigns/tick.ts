import type { APIRoute } from 'astro';
import { resolveEnv } from '../../../lib/env';
import { tick } from '../../../lib/campaigns';
import type { D1Like } from '../../../lib/db';

export const prerender = false;

// Called every 5 minutes by .github/workflows/campaign-send.yml with a shared secret: starts scheduled campaigns and
// sends the next batches of any campaign that is sending. Answers 404 to anyone without the secret.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = resolveEnv(locals);
  const db: D1Like | undefined = env.DB;
  if (!env.CAMPAIGN_CRON_SECRET || request.headers.get('authorization') !== `Bearer ${env.CAMPAIGN_CRON_SECRET}` || !db) return new Response('Not found', { status: 404 });
  try {
    return new Response(JSON.stringify(await tick(env, db)), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('campaign tick failed', err instanceof Error ? err.message : 'error');
    return new Response(JSON.stringify({ error: 'failed' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }
};
