// Who owns each WhatsApp chat (milestone 4): the agent, a person, or nobody
// because the guest opted out. This file holds every state change and the inbox
// queries; the webhook, sendDraft and the admin pages call it and never set
// `state` themselves. Columns: schema_whatsapp.sql and schema_whatsapp_inbox.sql.
//
//   agent       the agent drafts replies; staff review and send them
//   handed_off  a draft said a person is needed; staff have been alerted
//   staff       a person is handling the chat; no new drafts
//   opted_out   the guest asked us to stop; no drafts, no alerts
import type { D1Like } from './db';
import type { WaMessage } from './whatsapp';

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
      await db.prepare(`UPDATE wa_conversations SET state = 'agent', handoff_reason = '', handed_off_at = NULL WHERE id = ?`).bind(m.phone).run();
    }
    return 'skip';
  }
  if (state === 'staff') {
    const active = conv?.staff_active_at ? Date.parse(conv.staff_active_at) : 0;
    if (now.getTime() - active < STAFF_HOLD_MS) return 'skip';
    await db.prepare(`UPDATE wa_conversations SET state = 'agent', staff_active_at = NULL WHERE id = ? AND state = 'staff'`).bind(m.phone).run();
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

// Hands the chat back to the agent. An opted-out guest stays opted out until they write START.
export async function giveBack(db: D1Like, phone: string): Promise<void> {
  await db
    .prepare(
      `UPDATE wa_conversations SET state = 'agent', handoff_reason = '', handed_off_at = NULL, staff_active_at = NULL
       WHERE id = ? AND state != 'opted_out'`
    )
    .bind(phone)
    .run();
}

// ----------------------------------------------------------------------- inbox

export type InboxFilter = 'attention' | 'staff' | 'all';

export interface InboxRow {
  id: string;
  profile_name: string | null;
  state: ChatState;
  handoff_reason: string;
  last_in: string | null;
  last_reply: string | null;
  // The guest has written and nobody has replied since.
  waiting: boolean;
  waitingMs: number;
  // Time left to reply freely; negative when the 24-hour window has closed.
  windowLeftMs: number | null;
  tone: 'red' | 'amber' | 'none';
}

export async function inboxCounts(db: D1Like): Promise<Record<string, number>> {
  const { results } = await db.prepare(`SELECT state, COUNT(*) AS n FROM wa_conversations GROUP BY state`).bind().all<{ state: string; n: number }>();
  return Object.fromEntries(results.map((r) => [r.state, r.n]));
}

export async function listInbox(db: D1Like, filter: InboxFilter, now: Date = new Date()): Promise<InboxRow[]> {
  const where = filter === 'attention' ? `WHERE c.state = 'handed_off'` : filter === 'staff' ? `WHERE c.state = 'staff'` : '';
  const { results } = await db
    .prepare(
      `SELECT c.id, c.profile_name, c.state, c.handoff_reason,
         (SELECT MAX(m.sent_at) FROM wa_messages m WHERE m.conversation_id = c.id AND m.direction = 'in') AS last_in,
         (SELECT MAX(m.sent_at) FROM wa_messages m WHERE m.conversation_id = c.id AND m.direction != 'in') AS last_reply
       FROM wa_conversations c ${where}
       ORDER BY c.last_message_at DESC LIMIT 200`
    )
    .bind()
    .all<Pick<InboxRow, 'id' | 'profile_name' | 'state' | 'handoff_reason' | 'last_in' | 'last_reply'>>();

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
