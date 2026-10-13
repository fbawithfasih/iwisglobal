import type { APIRoute } from 'astro';
import { resolveEnv } from '../../../lib/env';
import { parseWebhook, storeWebhook, verifySignature, type WaMessage } from '../../../lib/whatsapp';
import { generateDraft } from '../../../lib/waDraft';
import { routeIncoming, onStaffReply, markHandedOff } from '../../../lib/waInbox';
import { sendWhatsappHandoffEmail } from '../../../lib/email';
import type { D1Like } from '../../../lib/db';

export const prerender = false;

// WhatsApp Business Platform webhook (reply agent). Stores every message on the
// business number, writes a draft reply for each new guest message, and keeps
// track of who owns the chat (src/lib/waInbox.ts): a reply typed in the
// WhatsApp Business app hands the chat to staff, and a message that needs a
// person sends an email alert. It never sends anything to the guest: staff
// send drafts from /admin/whatsapp.
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

// One new guest message: apply opt-out and staff-handling rules, draft a reply,
// and if the draft says a person is needed, move the chat there and alert staff
// (once, not for every message).
async function handleGuestMessage(env: Record<string, any>, db: D1Like, m: WaMessage): Promise<void> {
  if ((await routeIncoming(db, m)) === 'skip') return;
  await generateDraft(env, db, m);

  const draft = await db
    .prepare(`SELECT needs_person, reason, body FROM wa_drafts WHERE message_id = ?`)
    .bind(m.waMessageId)
    .first<{ needs_person: number; reason: string; body: string }>();
  if (!draft?.needs_person) return;
  if (!(await markHandedOff(db, m.phone, draft.reason || 'handoff'))) return;

  const { results } = await db
    .prepare(`SELECT direction, body FROM wa_messages WHERE conversation_id = ? ORDER BY sent_at DESC LIMIT 4`)
    .bind(m.phone)
    .all<{ direction: string; body: string }>();
  await sendWhatsappHandoffEmail(env, {
    name: m.profileName,
    phone: m.phone,
    reason: draft.reason || 'handoff',
    lastMessages: results.reverse(),
    draft: draft.body,
  });
}

async function processMessages(env: Record<string, any>, db: D1Like, messages: WaMessage[]): Promise<void> {
  // One at a time, so several messages in one delivery cannot race on the chat's state.
  for (const m of messages) {
    try {
      if (m.direction === 'echo') await onStaffReply(db, m.phone, new Date(m.sentAt));
      else if (m.direction === 'in') await handleGuestMessage(env, db, m);
    } catch (err) {
      console.error('whatsapp webhook: processing failed', err);
    }
  }
}

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

  let added: WaMessage[];
  try {
    added = await storeWebhook(db, parseWebhook(payload));
  } catch (err) {
    // 500 makes Meta retry; the unique message ID makes the retry safe.
    console.error('whatsapp webhook: store failed', err);
    return new Response('error', { status: 500 });
  }

  // Drafting calls a model, so it runs after the 200 goes back to Meta.
  const work = processMessages(env, db, added);
  const ctx = (locals as { runtime?: { ctx?: { waitUntil(p: Promise<unknown>): void } } }).runtime?.ctx;
  if (ctx) ctx.waitUntil(work);
  else await work;
  return new Response('ok', { status: 200 });
};
