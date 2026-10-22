import type { APIRoute } from 'astro';
import { resolveEnv } from '../../../lib/env';
import { verifySignature } from '../../../lib/whatsapp';
import { parseMetaWebhook, processMetaEvents, storeMetaEvents } from '../../../lib/meta';
import type { D1Like } from '../../../lib/db';

export const prerender = false;

// Facebook / Instagram webhook: lead-ad notifications (leadgen), Instagram DMs and Messenger messages
// become leads (src/lib/meta.ts). Same shape as the WhatsApp webhook: the signature covers the raw
// body, the event is stored before replying 200 (Meta does not retry after a 200), the real work runs
// after the reply, and src/pages/api/meta/poll.ts retries anything that failed.
//
// Setup is in docs/meta-leads-runbook.md. Secrets (Cloudflare Pages): META_VERIFY_TOKEN, META_APP_SECRET,
// META_PAGE_ACCESS_TOKEN, META_PAGE_ID, META_POLL_SECRET.

export const GET: APIRoute = ({ url, locals }) => {
  const env = resolveEnv(locals);
  if (
    env.META_VERIFY_TOKEN &&
    url.searchParams.get('hub.mode') === 'subscribe' &&
    url.searchParams.get('hub.verify_token') === env.META_VERIFY_TOKEN
  ) {
    return new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 });
  }
  return new Response('forbidden', { status: 403 });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const env = resolveEnv(locals);
  const rawBody = await request.text();

  if (!env.META_APP_SECRET) {
    console.error('meta webhook: META_APP_SECRET not configured');
    return new Response('not configured', { status: 503 });
  }
  if (!(await verifySignature(rawBody, request.headers.get('x-hub-signature-256'), env.META_APP_SECRET))) {
    console.error('meta webhook: signature mismatch');
    return new Response('invalid signature', { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response('invalid JSON', { status: 400 });
  }
  const db: D1Like | undefined = env.DB;
  if (!db) return new Response('no database', { status: 503 });

  let fresh;
  try {
    fresh = await storeMetaEvents(db, parseMetaWebhook(payload));
  } catch (err) {
    // 500 makes Meta retry; the unique event id makes the retry safe.
    console.error('meta webhook: store failed', err instanceof Error ? err.message : 'error');
    return new Response('error', { status: 500 });
  }

  const work = processMetaEvents(env, db, fresh).catch((err) => console.error('meta webhook: processing failed', err instanceof Error ? err.message : 'error'));
  const ctx = (locals as { runtime?: { ctx?: { waitUntil(p: Promise<unknown>): void } } }).runtime?.ctx;
  if (ctx) ctx.waitUntil(work);
  else await work;
  return new Response('ok', { status: 200 });
};
