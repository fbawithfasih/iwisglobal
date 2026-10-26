import type { D1Like } from './db';
import type { BookingRow } from './crm';
import { OPEN_STAGES } from './contacts';
import { AWAITING_STATUS } from './customTripPayment';
import { viewCounts } from './leadsAdmin';
import { inboxCounts, listInbox, type InboxRow } from './waInbox';

// Everything on the admin "Today" page (src/pages/admin/today.astro). Counts only, each one from a named query over tables
// that already exist: no trends and no money figures, so every number can be checked against the list it links to.

export const addDays = (ymd: string, days: number): string => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export interface UnansweredLead { id: string; name: string; channel: string; created_at: string }
export interface MyFollowUp { id: string; name: string; next_action_at: string; overdueDays: number }

export interface TodayBoard {
  today: string;
  tomorrow: string;
  /** Confirmed trips on these two dates, soonest first. */
  trips: BookingRow[];
  /** Bookings the guest has paid for that wait for the team to confirm (custom trips). */
  awaitingConfirmation: number;
  /** WhatsApp chats whose last message is from the guest with no reply since, longest-waiting first (top few) and the total.
   *  Counted over the 200 most recent chats, the same window the WhatsApp inbox shows. */
  chatsWaiting: { total: number; top: InboxRow[] };
  /** Chats the agent handed to a person. */
  chatsHandedOff: number;
  /** Leads still at New (nobody has replied), oldest first (top few) and the total. */
  leadsUnanswered: { total: number; top: UnansweredLead[] };
  /** Open leads whose follow-up date has come, all owners. */
  followUpsDue: number;
  /** The signed-in person's own open leads with a follow-up due, soonest first. */
  myFollowUps: MyFollowUp[];
  myLeads: number;
  myChats: number;
  /** Sections that could not load (named), so the page can say so instead of showing a wrong zero or failing as a whole. */
  failed: Array<'trips' | 'chats' | 'leads'>;
}

const TOP = 5;

export async function loadToday(db: D1Like, opts: { today: string; me: string; now?: Date }): Promise<TodayBoard> {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const tomorrow = addDays(opts.today, 1);
  const stages = OPEN_STAGES.map(() => '?').join(',');
  const failed: TodayBoard['failed'] = [];
  // Each section loads on its own: a failure in one (say a table not created yet) leaves the others intact and is reported.
  const part = async <T,>(name: TodayBoard['failed'][number], fallback: T, run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (err) {
      console.error(`today board: ${name} failed`, err instanceof Error ? err.message : 'error');
      failed.push(name);
      return fallback;
    }
  };

  const [trips, chats, leads] = await Promise.all([
    part('trips', { rows: [] as BookingRow[], awaiting: 0 }, async () => ({
      rows: (await db.prepare(`SELECT * FROM bookings WHERE status = 'confirmed' AND travel_date IN (?, ?) ORDER BY travel_date, pickup_time, created_at`).bind(opts.today, tomorrow).all<BookingRow>()).results,
      awaiting: (await db.prepare(`SELECT COUNT(*) AS n FROM bookings WHERE status = ?`).bind(AWAITING_STATUS).first<{ n: number }>())?.n ?? 0,
    })),
    part('chats', { waiting: [] as InboxRow[], handedOff: 0, mine: 0 }, async () => {
      const inbox = await listInbox(db, 'all', now, opts.me);
      const counts = await inboxCounts(db, opts.me);
      return {
        waiting: inbox.filter((c) => c.waiting && c.state !== 'opted_out').sort((a, b) => b.waitingMs - a.waitingMs),
        handedOff: counts.handed_off ?? 0,
        mine: counts.mine ?? 0,
      };
    }),
    part('leads', { counts: {} as Record<string, number>, unanswered: [] as UnansweredLead[], mine: [] as { id: string; name: string; next_action_at: string }[] }, async () => ({
      counts: await viewCounts(db, nowIso, opts.me),
      unanswered: (await db.prepare(`SELECT id, name, channel, created_at FROM leads WHERE status = 'new' ORDER BY created_at LIMIT ?`).bind(TOP).all<UnansweredLead>()).results,
      mine: opts.me
        ? (await db.prepare(`SELECT id, name, next_action_at FROM leads WHERE status IN (${stages}) AND owner = ? AND next_action_at IS NOT NULL AND next_action_at <= ? ORDER BY next_action_at LIMIT 10`)
            .bind(...OPEN_STAGES, opts.me, nowIso).all<{ id: string; name: string; next_action_at: string }>()).results
        : [],
    })),
  ]);

  return {
    today: opts.today,
    tomorrow,
    trips: trips.rows,
    awaitingConfirmation: trips.awaiting,
    chatsWaiting: { total: chats.waiting.length, top: chats.waiting.slice(0, TOP) },
    chatsHandedOff: chats.handedOff,
    leadsUnanswered: { total: leads.counts.unanswered ?? 0, top: leads.unanswered },
    followUpsDue: leads.counts.followups ?? 0,
    myFollowUps: leads.mine.map((r) => ({ ...r, overdueDays: Math.max(0, Math.floor((now.getTime() - Date.parse(r.next_action_at)) / 86_400_000)) })),
    myLeads: leads.counts.mine ?? 0,
    myChats: chats.mine,
    failed,
  };
}
