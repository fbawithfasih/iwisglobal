// WhatsApp Business Platform (Cloud API) plumbing for the reply agent,
// milestone 1: check Meta's signature, read its webhook payload, store each
// conversation and message once, and send a text. No AI and no automatic reply
// yet (.claude/plans/whatsapp-reply-agent.plan.md). The webhook route is
// src/pages/api/webhooks/whatsapp.ts; the tables are schema_whatsapp.sql.
import type { D1Like } from './db';

// One place for Meta's Graph API version. Recheck Meta's changelog when raising it.
export const GRAPH_API_VERSION = 'v21.0';

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// `header` is X-Hub-Signature-256: "sha256=" + HMAC-SHA256 of the exact raw body,
// keyed with the Meta app secret. False when either input is missing.
export async function verifySignature(rawBody: string, header: string | null, appSecret: string | undefined): Promise<boolean> {
  if (!appSecret || !header?.startsWith('sha256=')) return false;
  const expected = await hmacSha256Hex(appSecret, rawBody);
  return timingSafeEqual(header.slice('sha256='.length).toLowerCase(), expected);
}

// WhatsApp gives phones as digits with the country code. Strip anything else.
export function normalisePhone(value: string): string {
  return value.replace(/\D/g, '');
}

export type WaDirection = 'in' | 'out' | 'echo';

export interface WaMessage {
  waMessageId: string;
  // The guest's phone, whichever way the message went.
  phone: string;
  direction: WaDirection;
  kind: string;
  body: string;
  profileName: string | null;
  sentAt: string;
  // Click-to-WhatsApp ad data. Meta sends it on the first message of an ad click only.
  referral?: { sourceId: string; sourceUrl: string; headline: string; ctwaClid: string };
}

export interface WaStatusUpdate {
  waMessageId: string;
  status: string;
}

export interface ParsedWebhook {
  messages: WaMessage[];
  statuses: WaStatusUpdate[];
}

const unixToIso = (seconds: unknown): string => {
  const n = Number(seconds);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : new Date().toISOString();
};

// What a message looks like in the admin list: its text, or the kind in
// brackets when it is a voice note, image, location and so on.
function messageBody(m: any): { kind: string; body: string } {
  const kind = typeof m?.type === 'string' ? m.type : 'unknown';
  if (kind === 'text') return { kind, body: String(m.text?.body ?? '') };
  if (kind === 'button') return { kind, body: String(m.button?.text ?? '') };
  if (kind === 'interactive') {
    return { kind, body: String(m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '') };
  }
  const caption = m?.[kind]?.caption;
  return { kind, body: caption ? `[${kind}] ${caption}` : `[${kind}]` };
}

// Meta wraps events as entry[].changes[].value. Guest messages arrive in
// `messages`, replies staff typed in the WhatsApp Business app arrive in
// `smb_message_echoes` (coexistence) and delivery updates in `statuses`.
// Unknown shapes are skipped, never thrown.
export function parseWebhook(payload: any): ParsedWebhook {
  const out: ParsedWebhook = { messages: [], statuses: [] };
  for (const entry of Array.isArray(payload?.entry) ? payload.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change?.value;
      if (!value) continue;

      const names = new Map<string, string>();
      for (const c of Array.isArray(value.contacts) ? value.contacts : []) {
        if (c?.wa_id && c?.profile?.name) names.set(normalisePhone(String(c.wa_id)), String(c.profile.name));
      }

      for (const m of Array.isArray(value.messages) ? value.messages : []) {
        if (!m?.id || !m?.from) continue;
        const phone = normalisePhone(String(m.from));
        out.messages.push({
          waMessageId: String(m.id),
          phone,
          direction: 'in',
          ...messageBody(m),
          profileName: names.get(phone) ?? null,
          sentAt: unixToIso(m.timestamp),
          ...(m.referral
            ? {
                referral: {
                  sourceId: String(m.referral.source_id ?? ''),
                  sourceUrl: String(m.referral.source_url ?? ''),
                  headline: String(m.referral.headline ?? ''),
                  ctwaClid: String(m.referral.ctwa_clid ?? ''),
                },
              }
            : {}),
        });
      }

      for (const m of Array.isArray(value.smb_message_echoes) ? value.smb_message_echoes : []) {
        if (!m?.id || !m?.to) continue;
        out.messages.push({
          waMessageId: String(m.id),
          phone: normalisePhone(String(m.to)),
          direction: 'echo',
          ...messageBody(m),
          profileName: null,
          sentAt: unixToIso(m.timestamp),
        });
      }

      for (const s of Array.isArray(value.statuses) ? value.statuses : []) {
        if (s?.id && s?.status) out.statuses.push({ waMessageId: String(s.id), status: String(s.status) });
      }
    }
  }
  return out;
}

// Stores one message. A redelivered webhook carries the same Meta message ID,
// which is UNIQUE, so the second insert changes nothing and this returns false.
export async function storeMessage(db: D1Like, m: WaMessage): Promise<boolean> {
  const now = new Date().toISOString();
  const status = m.direction === 'in' ? 'received' : 'sent';
  const inserted = await db
    .prepare(
      `INSERT OR IGNORE INTO wa_messages (wa_message_id, conversation_id, direction, kind, body, status, sent_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(m.waMessageId, m.phone, m.direction, m.kind, m.body, status, m.sentAt, now)
    .run();
  if (!inserted.meta?.changes) return false;

  await db
    .prepare(
      `INSERT INTO wa_conversations (id, profile_name, last_message_at, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         profile_name = COALESCE(excluded.profile_name, wa_conversations.profile_name),
         last_message_at = MAX(wa_conversations.last_message_at, excluded.last_message_at)`
    )
    .bind(m.phone, m.profileName, m.sentAt, now)
    .run();
  return true;
}

export async function storeStatus(db: D1Like, s: WaStatusUpdate): Promise<void> {
  await db.prepare(`UPDATE wa_messages SET status = ? WHERE wa_message_id = ?`).bind(s.status, s.waMessageId).run();
}

// Stores everything in a parsed payload. Returns the messages that were new
// (a redelivered message is not returned, so callers act on each one once).
export async function storeWebhook(db: D1Like, parsed: ParsedWebhook): Promise<WaMessage[]> {
  const added: WaMessage[] = [];
  for (const m of parsed.messages) {
    if (await storeMessage(db, m)) added.push(m);
  }
  for (const s of parsed.statuses) await storeStatus(db, s);
  return added;
}

export interface SendResult {
  ok: boolean;
  waMessageId?: string;
  error?: string;
}

// Sends a free-form text. WhatsApp allows this only within 24 hours of the
// guest's last message. Never throws: a failed send comes back as { ok: false }.
export async function sendText(env: Record<string, any>, to: string, body: string): Promise<SendResult> {
  const token = env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) return { ok: false, error: 'WhatsApp is not configured' };
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: normalisePhone(to), type: 'text', text: { body } }),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: String(data?.error?.message ?? `HTTP ${res.status}`) };
    return { ok: true, waMessageId: data?.messages?.[0]?.id };
  } catch (err) {
    console.error('whatsapp: send failed', err);
    return { ok: false, error: 'network error' };
  }
}

// Sends an approved message template (the only message allowed to a guest outside the 24-hour
// window). `name` and `language` must match a template approved in Meta; `bodyParams` fill {{1}}, {{2}}...
// Never throws: a failed send comes back as { ok: false }.
export async function sendTemplate(env: Record<string, any>, to: string, name: string, language: string, bodyParams: string[]): Promise<SendResult> {
  const token = env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) return { ok: false, error: 'WhatsApp is not configured' };
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: normalisePhone(to),
        type: 'template',
        template: {
          name,
          language: { code: language },
          ...(bodyParams.length ? { components: [{ type: 'body', parameters: bodyParams.map((text) => ({ type: 'text', text })) }] } : {}),
        },
      }),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: String(data?.error?.message ?? `HTTP ${res.status}`) + (data?.error?.code ? ` (code ${data.error.code})` : '') };
    return { ok: true, waMessageId: data?.messages?.[0]?.id };
  } catch (err) {
    console.error('whatsapp: template send failed', err);
    return { ok: false, error: 'network error' };
  }
}
