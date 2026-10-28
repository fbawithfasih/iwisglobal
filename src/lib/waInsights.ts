import type { D1Like } from './db';
import type { InboxRow } from './waInbox';
import { silentMessageSql } from './whatsapp';
import { addDays } from './todayBoard';

// The pictures on the admin WhatsApp page (src/pages/admin/whatsapp/index.astro): messages per day and how late the waiting chats are.
// Counts only. Reactions, edits and deletions are not messages anyone has to answer, so they are left out, as the inbox leaves them out.

export const FLOW_DAYS = 14;

export interface MessageDay { day: string; guest: number; ours: number }

/** The last `days` India days, oldest first, the last being today: messages from guests, and messages we sent (site and phone app). */
export async function messageFlow(db: D1Like, today: string, days = FLOW_DAYS): Promise<MessageDay[]> {
  const first = addDays(today, -(days - 1));
  const since = new Date(`${first}T00:00:00+05:30`).toISOString();
  const { results } = await db
    .prepare(
      `SELECT date(m.sent_at, '+330 minutes') AS d,
              SUM(CASE WHEN m.direction = 'in' THEN 1 ELSE 0 END) AS guest,
              SUM(CASE WHEN m.direction IN ('out', 'echo') THEN 1 ELSE 0 END) AS ours
       FROM wa_messages m WHERE m.sent_at >= ? AND NOT ${silentMessageSql('m')} GROUP BY d`
    )
    .bind(since)
    .all<{ d: string; guest: number; ours: number }>();
  const by = new Map(results.map((r) => [r.d, r]));
  return Array.from({ length: days }, (_, i) => {
    const day = addDays(first, i);
    return { day, guest: by.get(day)?.guest ?? 0, ours: by.get(day)?.ours ?? 0 };
  });
}

export interface WaitBuckets { calm: number; soon: number; late: number }

/** Chats whose guest is waiting, by how long: under an hour, one to four hours, longer. Opted-out chats never count. */
export function waitBuckets(rows: Pick<InboxRow, 'waiting' | 'waitingMs' | 'state'>[]): WaitBuckets {
  const out: WaitBuckets = { calm: 0, soon: 0, late: 0 };
  for (const r of rows) {
    if (!r.waiting || r.state === 'opted_out') continue;
    if (r.waitingMs < 3_600_000) out.calm += 1;
    else if (r.waitingMs < 4 * 3_600_000) out.soon += 1;
    else out.late += 1;
  }
  return out;
}

export interface WindowBuckets { plenty: number; closing: number; closed: number }

/** The 24-hour reply window of the chats that have one: over two hours left, under two hours left, closed. */
export function windowBuckets(rows: Pick<InboxRow, 'windowLeftMs' | 'state'>[]): WindowBuckets {
  const out: WindowBuckets = { plenty: 0, closing: 0, closed: 0 };
  for (const r of rows) {
    if (r.windowLeftMs === null || r.state === 'opted_out') continue;
    if (r.windowLeftMs <= 0) out.closed += 1;
    else if (r.windowLeftMs < 2 * 3_600_000) out.closing += 1;
    else out.plenty += 1;
  }
  return out;
}
