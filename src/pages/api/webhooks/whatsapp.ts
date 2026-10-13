import type { APIRoute } from 'astro';
import { resolveEnv } from '../../../lib/env';
import { parseWebhook, storeWebhook, verifySignature } from '../../../lib/whatsapp';
import { generateDraft } from '../../../lib/waDraft';

export const prerender = false;

// WhatsApp Business Platform webhook (reply agent). Stores every message on the
// business number and writes a draft reply for each new guest message (milestone
// 2). It never sends anything: staff send drafts from /admin/whatsapp.
//
// Setup (Meta developer app → WhatsApp → Configuration → Webhook):
//   1. Callback URL https://www.iwisglobal.com/api/webhooks/whatsapp
//   2. Verify token = the WHATSAPP_VERIFY_TOKEN you set in Cloudflare
//   3. Subscribe to "messages" (and "smb_message_echoes" for staff replies sent
//      from the WhatsApp Business app)
// Secrets (Cloudflare Pages): WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET.

// Meta's one-time "Verify and save" check: echo hub.challenge back, but only
// when the verify token matches.
export const GET: APIRoute = ({ url, locals }) => {
  const env = resolveEnv(locals);
  const token = url.searchParams.get('hub.verify_token');
  if (
    env.WHATSAPP_VERIFY_TOKEN &&
    url.searchParams.get('hub.mode') === 'subscribe' &&
    token === env.WHATSAPP_VERIFY_TOKEN
  ) {
    return new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 });
  }
  return new Response('forbidden', { status: 403 });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const env = resolveEnv(locals);

  // The signature covers the exact raw bytes, so read the text before parsing.
  const rawBody = await request.text();

  // Unlike the Razorpay webhook, an unconfigured secret is an error, not an ack:
  // storing unverified messages would let anyone fill the database.
  if (!env.WHATSAPP_APP_SECRET) {
    console.error('whatsapp webhook: WHATSAPP_APP_SECRET not configured');
    return new Response('not configured', { status: 503 });
  }
  if (!(await verifySignature(rawBody, request.headers.get('x-hub-signature-256'), env.WHATSAPP_APP_SECRET))) {
    console.error('whatsapp webhook: signature mismatch');
    return new Response('invalid signature', { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response('invalid JSON', { status: 400 });
  }

  const db = env.DB;
  if (!db) return new Response('no database', { status: 503 });

  let added;
  try {
    added = await storeWebhook(db, parseWebhook(payload));
  } catch (err) {
    // 500 makes Meta retry; the unique message ID makes the retry safe.
    console.error('whatsapp webhook: store failed', err);
    return new Response('error', { status: 500 });
  }

  // Drafting calls a model, so it runs after the 200 goes back to Meta.
  const drafting = Promise.all(added.filter((m) => m.direction === 'in').map((m) => generateDraft(env, db, m)));
  const ctx = (locals as { runtime?: { ctx?: { waitUntil(p: Promise<unknown>): void } } }).runtime?.ctx;
  if (ctx) ctx.waitUntil(drafting);
  else await drafting;
  return new Response('ok', { status: 200 });
};
