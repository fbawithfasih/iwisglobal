// Sends a booking's pickup details to the guest through the WhatsApp Business API, from the admin, so the message is in
// the backend inbox (not typed into a phone). Inside WhatsApp's 24-hour window it is a normal text; outside it, the
// approved pickup template. Never sends to a guest who opted out.
import type { D1Like } from './db';
import { sendTemplate, storeMessage, normalisePhone } from './whatsapp';
import { sendStaffMessage } from './waDraft';
import { attributeSend, takeOver, WINDOW_MS } from './waInbox';
import { PICKUP_TEMPLATE, pickupTemplateParams, renderPickupTemplate, type PickupFacts } from './waTemplates';

export interface PickupSendResult {
  ok: boolean;
  /** How it went out when ok: a free text inside the window, or the approved template outside it. */
  via?: 'text' | 'template';
  error?: string;
}

/** The text a guest reads when the window is open. Only what has been filled in. */
export function pickupText(f: PickupFacts, paymentId: string): string | null {
  const parts = [
    f.pickupTime && `pickup ${f.pickupTime}`,
    f.vehicle && `vehicle ${f.vehicle}`,
    f.guide && `guide ${f.guide}`,
    f.driverName && `driver ${f.driverName}${f.driverPhone ? ` (${f.driverPhone})` : ''}`,
  ].filter(Boolean);
  if (!parts.length) return null;
  const first = f.guestName.trim().split(/\s+/)[0] || 'there';
  return `Hi ${first}, here are the details for your ${f.tourTitle || 'tour'} on ${f.dateLabel}: ${parts.join(', ')}. Payment reference: ${paymentId}`;
}

export async function sendPickupDetails(
  env: Record<string, any>,
  db: D1Like,
  guestPhone: string,
  facts: PickupFacts,
  paymentId: string,
  person = ''
): Promise<PickupSendResult> {
  if (!guestPhone.trim().startsWith('+')) return { ok: false, error: "This booking's phone number has no country code (+), so WhatsApp cannot reach it." };
  const phone = normalisePhone(guestPhone);
  const text = pickupText(facts, paymentId);
  if (!text) return { ok: false, error: 'Fill in the pickup time, vehicle or driver first, then save the itinerary.' };

  const chat = await db.prepare(`SELECT state FROM wa_conversations WHERE id = ?`).bind(phone).first<{ state: string }>();
  if (chat?.state === 'opted_out') return { ok: false, error: 'The guest asked us to stop, so nothing can be sent.' };

  const last = chat
    ? await db.prepare(`SELECT MAX(sent_at) AS at FROM wa_messages WHERE conversation_id = ? AND direction = 'in'`).bind(phone).first<{ at: string | null }>()
    : null;
  if (last?.at && Date.now() - Date.parse(last.at) <= WINDOW_MS) {
    const sent = await sendStaffMessage(env, db, phone, text, person);
    return sent.ok ? { ok: true, via: 'text' } : { ok: false, error: sent.error };
  }

  // The window is closed (or the guest never wrote): only the approved template may be sent. One per guest per 24 hours.
  const recent = await db
    .prepare(`SELECT MAX(sent_at) AS at FROM wa_messages WHERE conversation_id = ? AND direction = 'out' AND kind = 'template'`)
    .bind(phone)
    .first<{ at: string | null }>();
  if (recent?.at && Date.now() - Date.parse(recent.at) < WINDOW_MS) {
    return { ok: false, error: 'A template was already sent to this guest in the last 24 hours. Wait for their reply, then send the details as a normal message.' };
  }
  const params = pickupTemplateParams(facts);
  const sent = await sendTemplate(env, phone, PICKUP_TEMPLATE.name, PICKUP_TEMPLATE.language, params);
  if (!sent.ok) {
    const missing = /template|132001|132000|132012/i.test(sent.error ?? '');
    return {
      ok: false,
      error: missing
        ? `WhatsApp does not have the template "${PICKUP_TEMPLATE.name}" (${PICKUP_TEMPLATE.language}) approved yet: ${sent.error}. Submit it in Meta and wait for approval, or open WhatsApp on a phone for now.`
        : `WhatsApp refused the message: ${sent.error ?? 'unknown error'}`,
    };
  }
  const waMessageId = sent.waMessageId ?? `local-${crypto.randomUUID()}`;
  await storeMessage(db, { waMessageId, phone, direction: 'out', kind: 'template', body: renderPickupTemplate(params), profileName: null, sentAt: new Date().toISOString() });
  await takeOver(db, phone);
  await attributeSend(db, phone, waMessageId, person);
  return { ok: true, via: 'template' };
}
