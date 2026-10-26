// Who owns each WhatsApp chat (milestone 4): the agent, a person, or nobody
// because the guest opted out. This file holds every state change and the inbox
// queries; the webhook, sendDraft and the admin pages call it and never set
// `state` themselves. Columns: schema_whatsapp.sql, schema_whatsapp_inbox.sql and schema_whatsapp_handler.sql
// (handled_by: which person has a chat, so two people do not answer the same guest).
//
//   agent       the agent drafts replies; staff review and send them
//   handed_off  a draft said a person is needed; staff have been alerted
//   staff       a person is handling the chat; no new drafts
//   opted_out   the guest asked us to stop; no drafts, no alerts
import type { D1Like } from './db';
import type { WaMessage } from './whatsapp';
import { isValidHolder } from './authz';

export type ChatState = 'agent' | 'handed_off' | 'staff' | 'opted_out';

export const STAFF_HOLD_MS = 12 * 60 * 60 * 1000; // a staff chat returns to the agent after this
export const ALERT_GAP_MS = 2 * 60 * 60 * 1000; // at most one alert per chat in this time
export const WAIT_AMBER_MS = 30 * 60 * 1000; // a guest waiting longer than this shows amber
export const WINDOW_MS = 24 * 60 * 60 * 1000; // WhatsApp's free-reply window after a guest message
export const WINDOW_RED_MS = 2 * 60 * 60 * 1000; // red when less than this is left

const norm = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();

// Whole-message matches only: "stop" inside a sentence ("please stop by the hotel")
// is not an opt-out. "cancel" is left out on purpose, it means cancelling a booking.
const STOP_PHRASES = new Set(['stop', 'unsubscribe', 'opt out', 'optout', 'stop messages', 'stop messaging', 'band karo', 'बंद करो']);
const START_PHRASES = new Set(['start', 'subscribe', 'resume']);

export function optOutIntent(text: string): 'stop' | 'start' | null {
  const t = norm(text);
  if (STOP_PHRASES.has(t)) return 'stop';
  if (START_PHRASES.has(t)) return 'start';
  return null;
}

interface ConversationRow {
  state: ChatState;
  staff_active_at: string | null;
}

// Decides whether a new guest message should get a draft, and applies opt-out
// and staff-expiry on the way.
export async function routeIncoming(db: D1Like, m: WaMessage, now: Date = new Date()): Promise<'draft' | 'skip'> {
  const intent = m.kind === 'text' ? optOutIntent(m.body) : null;
  const conv = await db.prepare(`SELECT state, staff_active_at FROM wa_conversations WHERE id = ?`).bind(m.phone).first<ConversationRow>();
  const state = conv?.state ?? 'agent';

  if (intent === 'stop') {
    await db.prepare(`UPDATE wa_conversations SET state = 'opted_out' WHERE id = ?`).bind(m.phone).run();
    return 'skip';
  }
  if (state === 'opted_out') {
    if (intent === 'start') {
      await db.prepare(`UPDATE wa_conversations SET state = 'agent', handoff_reason = '', handed_off_at = NULL, handled_by = '' WHERE id = ?`).bind(m.phone).run();
    }
    return 'skip';
  }
  if (state === 'staff') {
    const active = conv?.staff_active_at ? Date.parse(conv.staff_active_at) : 0;
    if (now.getTime() - active < STAFF_HOLD_MS) return 'skip';
    await db.prepare(`UPDATE wa_conversations SET state = 'agent', staff_active_at = NULL, handled_by = '' WHERE id = ? AND state = 'staff'`).bind(m.phone).run();
  }
  return 'draft';
}

// A person replied from the WhatsApp Business app (an echo): the chat is theirs.
export async function onStaffReply(db: D1Like, phone: string, at: Date = new Date()): Promise<void> {
  await db
    .prepare(`UPDATE wa_conversations SET state = 'staff', staff_active_at = ? WHERE id = ? AND state != 'opted_out'`)
    .bind(at.toISOString(), phone)
    .run();
}

// Staff pressed Send on a draft in the admin. That is the agent's reply approved,
// so the chat stays with the agent, unless it was waiting for a person, in which
// case a person has now dealt with it.
export async function onAdminSend(db: D1Like, phone: string, at: Date = new Date()): Promise<void> {
  await db
    .prepare(`UPDATE wa_conversations SET state = 'staff', staff_active_at = ? WHERE id = ? AND state = 'handed_off'`)
    .bind(at.toISOString(), phone)
    .run();
}

// Marks a chat as needing a person. True when an alert should go out now: on the
// move into handed_off, and again only after ALERT_GAP_MS of further messages.
// Both updates are conditional, so two messages arriving together alert once.
export async function markHandedOff(db: D1Like, phone: string, reason: string, now: Date = new Date()): Promise<boolean> {
  const at = now.toISOString();
  const moved = await db
    .prepare(
      `UPDATE wa_conversations SET state = 'handed_off', handoff_reason = ?, handed_off_at = ?, last_alert_at = ?
       WHERE id = ? AND state = 'agent'`
    )
    .bind(reason, at, at, phone)
    .run();
  if (moved.meta?.changes) return true;

  const gap = new Date(now.getTime() - ALERT_GAP_MS).toISOString();
  const again = await db
    .prepare(
      `UPDATE wa_conversations SET last_alert_at = ?, handoff_reason = ?
       WHERE id = ? AND state = 'handed_off' AND (last_alert_at IS NULL OR last_alert_at <= ?)`
    )
    .bind(at, reason, phone, gap)
    .run();
  return Boolean(again.meta?.changes);
}

export async function takeOver(db: D1Like, phone: string, now: Date = new Date()): Promise<void> {
  await db
    .prepare(`UPDATE wa_conversations SET state = 'staff', staff_active_at = ? WHERE id = ? AND state != 'opted_out'`)
    .bind(now.toISOString(), phone)
    .run();
}

// A person takes a chat: it becomes staff-handled (the agent stops drafting) and is theirs. The first person wins and
// nobody is overwritten: if someone else already has it, that person is returned. An opted-out guest cannot be taken.
export async function takeChat(db: D1Like, phone: string, me: string, now: Date = new Date()): Promise<{ ok: true } | { ok: false; heldBy: string } | { ok: false; reason: 'opted_out' | 'missing' }> {
  const who = me.trim().toLowerCase();
  const row = await db.prepare(`SELECT state, handled_by FROM wa_conversations WHERE id = ?`).bind(phone).first<{ state: ChatState; handled_by: string }>();
  if (!row) return { ok: false, reason: 'missing' };
  if (row.state === 'opted_out') return { ok: false, reason: 'opted_out' };
  if (row.handled_by === who) return { ok: true };
  const r = await db
    .prepare(`UPDATE wa_conversations SET handled_by = ?, state = 'staff', staff_active_at = ? WHERE id = ? AND handled_by = '' AND state != 'opted_out'`)
    .bind(who, now.toISOString(), phone)
    .run();
  if (r.meta?.changes) return { ok: true };
  const now2 = await db.prepare(`SELECT handled_by FROM wa_conversations WHERE id = ?`).bind(phone).first<{ handled_by: string }>();
  return now2?.handled_by === who ? { ok: true } : { ok: false, heldBy: now2?.handled_by ?? '' };
}

// Passes a chat to a named person (the owner login or a team member), whoever has it now. Returns false for an invalid
// target, an unknown chat or an opted-out guest.
export async function handOverChat(db: D1Like, phone: string, to: string, now: Date = new Date()): Promise<boolean> {
  const who = to.trim().toLowerCase();
  if (!who || !isValidHolder(who)) return false;
  const r = await db
    .prepare(`UPDATE wa_conversations SET handled_by = ?, state = 'staff', staff_active_at = ? WHERE id = ? AND state != 'opted_out' AND handled_by != ?`)
    .bind(who, now.toISOString(), phone, who)
    .run();
  return Boolean(r.meta?.changes);
}

// Records who sent an outgoing message and, if nobody has the chat, makes it theirs. Best effort: a failure here
// (for example before schema_whatsapp_handler.sql is applied) must never turn a message that was sent into an error.
export async function attributeSend(db: D1Like, phone: string, waMessageId: string, person: string): Promise<void> {
  const who = person.trim().toLowerCase();
  if (!who) return;
  try {
    await db.prepare(`UPDATE wa_messages SET sent_by = ? WHERE wa_message_id = ?`).bind(who, waMessageId).run();
    await db.prepare(`UPDATE wa_conversations SET handled_by = ? WHERE id = ? AND handled_by = '' AND state = 'staff'`).bind(who, phone).run();
  } catch (err) {
    console.error('whatsapp: could not record who sent a message', err instanceof Error ? err.message : 'error');
  }
}

// Hands the chat back to the agent. An opted-out guest stays opted out until they write START.
export async function giveBack(db: D1Like, phone: string): Promise<void> {
  await db
    .prepare(
      `UPDATE wa_conversations SET state = 'agent', handoff_reason = '', handed_off_at = NULL, staff_active_at = NULL, handled_by = ''
       WHERE id = ? AND state != 'opted_out'`
    )
    .bind(phone)
    .run();
}

// ----------------------------------------------------------------------- inbox

export type InboxFilter = 'attention' | 'staff' | 'mine' | 'all';

export interface InboxRow {
  id: string;
  profile_name: string | null;
  state: ChatState;
  handoff_reason: string;
  /** '' (nobody), 'owner' or a team member's email. */
  handled_by: string;
  last_in: string | null;
  last_reply: string | null;
  // The guest has written and nobody has replied since.
  waiting: boolean;
  waitingMs: number;
  // Time left to reply freely; negative when the 24-hour window has closed.
  windowLeftMs: number | null;
  tone: 'red' | 'amber' | 'none';
}

// Chats per state, plus `mine`: chats the given person is handling.
export async function inboxCounts(db: D1Like, me = ''): Promise<Record<string, number>> {
  const { results } = await db.prepare(`SELECT state, COUNT(*) AS n FROM wa_conversations GROUP BY state`).bind().all<{ state: string; n: number }>();
  const mine = me ? await db.prepare(`SELECT COUNT(*) AS n FROM wa_conversations WHERE handled_by = ? AND state != 'opted_out'`).bind(me).first<{ n: number }>() : null;
  return { ...Object.fromEntries(results.map((r) => [r.state, r.n])), mine: mine?.n ?? 0 };
}

export async function listInbox(db: D1Like, filter: InboxFilter, now: Date = new Date(), me = ''): Promise<InboxRow[]> {
  const where = filter === 'attention' ? `WHERE c.state = 'handed_off'` : filter === 'staff' ? `WHERE c.state = 'staff'` : filter === 'mine' ? `WHERE c.handled_by = ? AND c.state != 'opted_out'` : '';
  const args = filter === 'mine' ? [me || '\u0000'] : [];
  const { results } = await db
    .prepare(
      `SELECT c.id, c.profile_name, c.state, c.handoff_reason, c.handled_by,
         (SELECT MAX(m.sent_at) FROM wa_messages m WHERE m.conversation_id = c.id AND m.direction = 'in') AS last_in,
         (SELECT MAX(m.sent_at) FROM wa_messages m WHERE m.conversation_id = c.id AND m.direction != 'in') AS last_reply
       FROM wa_conversations c ${where}
       ORDER BY c.last_message_at DESC LIMIT 200`
    )
    .bind(...args)
    .all<Pick<InboxRow, 'id' | 'profile_name' | 'state' | 'handoff_reason' | 'handled_by' | 'last_in' | 'last_reply'>>();

  const rows: InboxRow[] = results.map((r) => {
    const lastIn = r.last_in ? Date.parse(r.last_in) : null;
    const waiting = lastIn !== null && (!r.last_reply || Date.parse(r.last_reply) < lastIn);
    const waitingMs = waiting && lastIn !== null ? now.getTime() - lastIn : 0;
    const windowLeftMs = lastIn !== null ? WINDOW_MS - (now.getTime() - lastIn) : null;
    let tone: InboxRow['tone'] = 'none';
    if (waiting && windowLeftMs !== null && windowLeftMs < WINDOW_RED_MS) tone = 'red';
    else if (waiting && waitingMs > WAIT_AMBER_MS) tone = 'amber';
    return { ...r, waiting, waitingMs, windowLeftMs, tone };
  });
  // Chats waiting on a person first (needs-a-person above the rest), longest wait first.
  const rank = (r: InboxRow) => (r.state === 'handed_off' ? 0 : r.waiting ? 1 : 2);
  return rows.sort((a, b) => rank(a) - rank(b) || b.waitingMs - a.waitingMs);
}

export function formatDuration(ms: number): string {
  const minutes = Math.max(Math.round(Math.abs(ms) / 60000), 0);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// A short fingerprint of everything the inbox shows: new or removed messages, new or
// changed drafts, and chat states. The admin page polls it (src/pages/admin/api/whatsapp/poll.ts)
// and reloads when it changes, so a guest's message appears without a manual refresh.
export async function inboxSignature(db: D1Like): Promise<string> {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM wa_messages) AS messages,
         (SELECT COALESCE(MAX(last_message_at), '') FROM wa_conversations) AS lastMessage,
         (SELECT COUNT(*) || ':' || COALESCE(MAX(updated_at), '') FROM wa_drafts) AS drafts,
         (SELECT COALESCE(group_concat(id || state || handled_by, ','), '') FROM (SELECT id, state, handled_by FROM wa_conversations ORDER BY id)) AS states`
    )
    .bind()
    .first<{ messages: number; lastMessage: string; drafts: string; states: string }>();
  return row ? `${row.messages}|${row.lastMessage}|${row.drafts}|${row.states}` : '';
}
