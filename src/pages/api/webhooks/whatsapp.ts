import type { APIRoute } from 'astro';
import { resolveEnv } from '../../../lib/env';
import { parseWebhook, storeWebhook, verifySignature, isSilentMessage, type WaMessage } from '../../../lib/whatsapp';
import { copyNewMedia } from '../../../lib/waMedia';
import { generateDraft, sendDraft } from '../../../lib/waDraft';
import { routeIncoming, onStaffReply, markHandedOff } from '../../../lib/waInbox';
import { sendWhatsappHandoffEmail, sendAutoReplyAlertEmail, HANDOFF_REASON_TEXT } from '../../../lib/email';
import { sendAdminPush } from '../../../lib/webPush';
import { getAutoSettings, autoPermission, holdingPermission } from '../../../lib/waAuto';
import type { D1Like } from '../../../lib/db';
import { maybePurge } from '../../../lib/waLearning';
import { recordLead } from '../../../lib/contacts';
import { parseWaRef } from '../../../lib/waSourceTag';
import { notifyNewLead } from '../../../lib/leadsAdmin';

export const prerender = false;

// WhatsApp Business Platform webhook (reply agent). Stores every message on the
// business number, writes a draft reply for each new guest message, and keeps
// track of who owns the chat (src/lib/waInbox.ts): a reply typed in the
// WhatsApp Business app hands the chat to staff, and a message that needs a
// person sends an email alert. Staff send drafts from /admin/whatsapp; the agent
// sends one itself only when auto-reply is switched on and the draft qualifies
// (src/lib/waAuto.ts), or, if enabled, a short holding note for a hand-off.
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
// then either send it (auto-reply on, intent enabled, draft qualifies) or, if the
// draft says a person is needed, move the chat there and alert staff (once, not
// for every message).
async function handleGuestMessage(env: Record<string, any>, db: D1Like, m: WaMessage): Promise<void> {
  if ((await routeIncoming(db, m)) === 'skip') return;
  await generateDraft(env, db, m);

  const draft = await db
    .prepare(`SELECT id, intent, needs_person, reason, body, auto_decision FROM wa_drafts WHERE message_id = ?`)
    .bind(m.waMessageId)
    .first<{ id: number; intent: string; needs_person: number; reason: string; body: string; auto_decision: string }>();
  if (!draft) return;
  const settings = await getAutoSettings(db);

  // A tripped breaker has already switched auto-reply off; tell the owner.
  const sendAutomatically = async (denial: string | null) => {
    if (denial === 'breaker') {
      await sendAutoReplyAlertEmail(env, {
        title: 'Automatic replies switched off',
        message: 'More automatic WhatsApp messages went out in the last hour than the safety limit allows, so automatic replies have been switched off. Check the audit list before turning them back on.',
      });
    } else if (!denial) {
      await sendDraft(env, db, draft.id, draft.body, 'auto');
    }
  };

  if (!draft.needs_person) {
    if (draft.auto_decision === 'eligible') {
      await sendAutomatically(await autoPermission(db, { intent: draft.intent, phone: m.phone, messageSentAt: m.sentAt }, settings));
    }
    return;
  }

  if (await markHandedOff(db, m.phone, draft.reason || 'handoff')) {
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
    // Also buzz the owner's phone. Names and the reason only, never the guest's message.
    await sendAdminPush(env, db, {
      title: 'WhatsApp: a guest needs a person',
      body: `${m.profileName || `+${m.phone}`}: ${HANDOFF_REASON_TEXT[draft.reason || 'handoff'] ?? 'needs a person'}`,
      url: `/admin/whatsapp?tab=attention&c=${m.phone}`,
      tag: `wa-${m.phone}`,
    });
  }

  // Optional short "a team member will reply" note for money and complaint messages.
  if (draft.reason === 'handoff') {
    await sendAutomatically(await holdingPermission(db, { phone: m.phone, body: draft.body }, settings));
  }
}

// Every first guest message becomes (or joins) a lead, with the "(ref: ...)" tag of the button
// they clicked and any click-to-WhatsApp ad data. Recorded per message id, so a replay adds
// nothing. A failure here must never stop the reply agent.
async function recordWhatsappLead(env: Record<string, any>, db: D1Like, m: WaMessage): Promise<void> {
  try {
    // "(ref: BOOKBAR-TOURS-... · via google/paid/123)": the site button, and the ad the visitor came from (src/lib/waSourceTag.ts).
    const { ref, source: viaSource, medium: viaMedium, campaign: viaCampaign } = parseWaRef(m.body);
    const res = await recordLead(db, {
      channel: 'whatsapp',
      identifiers: [{ type: 'wa_id', value: m.phone, source: 'whatsapp' }],
      name: m.profileName ?? undefined,
      message: m.body.slice(0, 500),
      type: 'message',
      externalRef: m.waMessageId,
      occurredAt: m.sentAt,
      attribution: {
        source: m.referral ? 'meta_ad' : viaSource || (ref ? 'website' : ''),
        medium: m.referral ? 'click_to_whatsapp' : viaSource ? viaMedium || 'paid' : ref ? 'whatsapp_button' : '',
        campaign: m.referral ? undefined : viaCampaign || undefined,
        adId: m.referral?.sourceId,
        ctwaClid: m.referral?.ctwaClid,
        landingPage: m.referral?.sourceUrl,
        refTag: ref,
      },
      payload: m.referral ? { referral: m.referral } : undefined,
    });
    if (res.createdLead) {
      await notifyNewLead(env, db, { id: res.leadId, name: m.profileName || `+${m.phone}`, channel: 'WhatsApp', detail: m.body.slice(0, 200) });
    }
  } catch (err) {
    console.error('whatsapp webhook: lead capture failed', err instanceof Error ? err.message : 'error');
  }
}

async function processMessages(env: Record<string, any>, db: D1Like, messages: WaMessage[]): Promise<void> {
  // Photos and voice notes first: Meta's download link is fetched while it is fresh.
  try {
    await copyNewMedia(env, db, messages.filter((m) => m.media).map((m) => m.waMessageId));
  } catch (err) {
    console.error('whatsapp webhook: media copy failed', err);
  }
  // One at a time, so several messages in one delivery cannot race on the chat's state.
  for (const m of messages) {
    try {
      if (m.direction === 'echo') await onStaffReply(db, m.phone, new Date(m.sentAt));
      // A reaction, or an edit or deletion of an earlier message: stored and shown, nothing to answer.
      else if (m.direction === 'in' && isSilentMessage(m)) continue;
      else if (m.direction === 'in') {
        await recordWhatsappLead(env, db, m);
        await handleGuestMessage(env, db, m);
      }
    } catch (err) {
      console.error('whatsapp webhook: processing failed', err);
    }
  }
  // Old message text is deleted once a day, triggered by whichever message arrives first.
  try {
    await maybePurge(db, new Date(), env.IMAGES);
  } catch (err) {
    console.error('whatsapp webhook: retention purge failed', err);
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
