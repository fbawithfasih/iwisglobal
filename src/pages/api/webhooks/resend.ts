import type { APIRoute } from 'astro';
import { resolveEnv } from '../../../lib/env';
import { handleResendEvent, verifySvix } from '../../../lib/resendEvents';
import type { D1Like } from '../../../lib/db';

export const prerender = false;

// Resend -> bounces, complaints and delivery events. The Svix signature is checked first; with no secret set the
// endpoint stays closed (503) rather than trusting anyone.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = resolveEnv(locals);
  const db: D1Like | undefined = env.DB;
  if (!env.RESEND_WEBHOOK_SECRET) return new Response('Not configured', { status: 503 });
  const body = await request.text();
  if (body.length > 200_000) return new Response('Too large', { status: 413 });
  const id = request.headers.get('svix-id') ?? '';
  const ok = await verifySvix(env.RESEND_WEBHOOK_SECRET, { id, timestamp: request.headers.get('svix-timestamp') ?? '', signature: request.headers.get('svix-signature') ?? '' }, body);
  if (!ok) return new Response('Bad signature', { status: 400 });
  if (!db) return new Response('Unavailable', { status: 503 });
  try {
    await handleResendEvent(db, id, body);
    return new Response('ok', { status: 200 });
  } catch (err) {
    console.error('resend webhook failed', err instanceof Error ? err.message : 'error');
    return new Response('Retry', { status: 500 });
  }
};
