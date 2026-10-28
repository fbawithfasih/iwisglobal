// Sending and opening a guest's WhatsApp chat from the admin through the Business API, so the message and the reply live in the
// backend inbox instead of a phone app. Inside WhatsApp's 24-hour window a normal text may be sent; outside it only an approved
// template may, so callers get windowClosed and offer another way. Never sends to a guest who opted out.
import type { D1Like } from './db';
import { normalisePhone } from './whatsapp';
import { sendStaffMessage } from './waDraft';
import { WINDOW_MS } from './waInbox';

export interface DirectSendResult {
  ok: boolean;
  /** True when the guest has not written in the last 24 hours, so a free text is not allowed. */
  windowClosed?: boolean;
  error?: string;
}

export async function sendWithinWindow(env: Record<string, any>, db: D1Like, guestPhone: string, text: string, person = ''): Promise<DirectSendResult> {
  if (!guestPhone.trim().startsWith('+')) return { ok: false, error: "This booking's phone number has no country code (+), so WhatsApp cannot reach it." };
  const phone = normalisePhone(guestPhone);
  const chat = await db.prepare(`SELECT state FROM wa_conversations WHERE id = ?`).bind(phone).first<{ state: string }>();
  if (chat?.state === 'opted_out') return { ok: false, error: 'The guest asked us to stop, so nothing can be sent.' };
  const last = chat
    ? await db.prepare(`SELECT MAX(sent_at) AS at FROM wa_messages WHERE conversation_id = ? AND direction = 'in'`).bind(phone).first<{ at: string | null }>()
    : null;
  if (!last?.at || Date.now() - Date.parse(last.at) > WINDOW_MS) {
    return { ok: false, windowClosed: true, error: 'This guest has not written on WhatsApp in the last 24 hours, so WhatsApp only allows approved templates.' };
  }
  const sent = await sendStaffMessage(env, db, phone, text, person);
  return sent.ok ? { ok: true } : { ok: false, error: sent.error };
}

/** Admin inbox links for the phones that already have a chat there; phones without one are left out. */
export async function chatLinks(db: D1Like, phones: (string | null | undefined)[]): Promise<Map<string, string>> {
  const ids = [...new Set(phones.filter((p): p is string => !!p && p.trim().startsWith('+')).map(normalisePhone).filter(Boolean))];
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const { results } = await db
    .prepare(`SELECT id FROM wa_conversations WHERE id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids)
    .all<{ id: string }>();
  for (const r of results ?? []) out.set(r.id, `/admin/whatsapp?c=${encodeURIComponent(r.id)}`);
  return out;
}

/** The chat link for one phone, or null. */
export async function chatLink(db: D1Like, phone: string | null | undefined): Promise<string | null> {
  if (!phone) return null;
  return (await chatLinks(db, [phone])).get(normalisePhone(phone)) ?? null;
}
