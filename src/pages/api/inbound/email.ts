import type { APIRoute } from 'astro';
import { resolveEnv } from '../../../lib/env';
import { handleInboundEmail, type InboundEmail } from '../../../lib/inboundEmail';
import type { D1Like } from '../../../lib/db';

export const prerender = false;

const MAX_BYTES = 200_000;

// Called by workers/inbound-email with a shared secret (see docs/inbound-email-runbook.md). Not public:
// anything without the secret gets a 404.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = resolveEnv(locals);
  const db: D1Like | undefined = env.DB;
  if (!env.INBOUND_EMAIL_SECRET || request.headers.get('x-inbound-secret') !== env.INBOUND_EMAIL_SECRET || !db) {
    return new Response('Not found', { status: 404 });
  }
  const raw = await request.text();
  if (raw.length > MAX_BYTES) return new Response('too large', { status: 413 });
  let body: InboundEmail;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response('bad request', { status: 400 });
  }
  if (!body?.from?.address) return new Response('bad request', { status: 400 });
  try {
    const result = await handleInboundEmail(env, db, body);
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    // 500 makes the Worker's caller see a failure; the Gmail copy is unaffected.
    console.error('inbound email failed', err instanceof Error ? err.message : 'error');
    return new Response('error', { status: 500 });
  }
};
