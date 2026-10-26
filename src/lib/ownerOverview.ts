import type { D1Like } from './db';
import { OPEN_STAGES } from './contacts';
import { AWAITING_STATUS } from './customTripPayment';

// The owner-only overview (src/pages/admin/overview.astro). Counts and money totals, each from one named query over tables
// that already exist. No trends or projections: with a small number of bookings a percentage would mislead.

/** The first day of the month containing an India-time date ("2026-10-27" gives "2026-10-01"). */
export const monthStart = (ymd: string): string => `${ymd.slice(0, 7)}-01`;

/** The UTC instant at which an India-time date begins, as an ISO string comparable with created_at columns. */
export const istStartUtc = (ymd: string): string => new Date(`${ymd}T00:00:00+05:30`).toISOString();

export interface MoneyLine { currency: string; minor: number }
export interface HolderLoad { holder: string; leads: number; chats: number }

export interface OwnerOverview {
  today: string;
  monthFrom: string;
  /** Bookings made since the month began, by status. */
  bookingsThisMonth: { confirmed: number; completed: number; cancelled: number; awaiting: number };
  /** Money paid so far on confirmed or completed bookings made this month, per currency. */
  paidThisMonth: MoneyLine[];
  /** Still to be collected on confirmed bookings (deposits not yet topped up), per currency. */
  balanceOutstanding: MoneyLine[];
  /** Confirmed trips travelling from today to the end of the next 30 days. */
  tripsNext30Days: number;
  /** Leads created in the last 30 days, and how they stand now. */
  leads30: { created: number; stillOpen: number; booked: number; lost: number };
  /** Open leads nobody holds. */
  leadsUnassigned: number;
  /** WhatsApp chats started in the last 30 days. */
  chats30: number;
  reviewsToCheck: number;
  /** Open leads and active chats per holder, busiest first. */
  workload: HolderLoad[];
  failed: Array<'bookings' | 'leads' | 'chats' | 'reviews'>;
}

const money = (rows: Array<{ currency: string; minor: number | null }>): MoneyLine[] =>
  rows.filter((r) => (r.minor ?? 0) !== 0).map((r) => ({ currency: r.currency, minor: r.minor ?? 0 })).sort((a, b) => b.minor - a.minor);

export async function loadOwnerOverview(db: D1Like, opts: { today: string; now?: Date }): Promise<OwnerOverview> {
  const now = opts.now ?? new Date();
  const from = monthStart(opts.today);
  const monthIso = istStartUtc(from);
  const since30 = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const end30 = new Date(Date.parse(`${opts.today}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
  const open = OPEN_STAGES.map(() => '?').join(',');
  const failed: OwnerOverview['failed'] = [];
  const part = async <T,>(name: OwnerOverview['failed'][number], fallback: T, run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (err) {
      console.error(`owner overview: ${name} failed`, err instanceof Error ? err.message : 'error');
      failed.push(name);
      return fallback;
    }
  };

  // Every query below is independent, so each section sends its queries together (one round trip per section, all
  // sections together): the database is far from the server and each round trip in a row costs a few hundred milliseconds.
  const [bookings, leads, chats, reviews] = await Promise.all([
    part('bookings', { by: {} as Record<string, number>, paid: [] as MoneyLine[], balance: [] as MoneyLine[], trips: 0 }, async () => {
      const [by, paid, balance, trips] = await Promise.all([
        db.prepare(`SELECT status, COUNT(*) AS n FROM bookings WHERE created_at >= ? GROUP BY status`).bind(monthIso).all<{ status: string; n: number }>(),
        db.prepare(`SELECT currency, SUM(amount_paid) AS minor FROM bookings WHERE created_at >= ? AND status IN ('confirmed','completed') GROUP BY currency`).bind(monthIso).all<{ currency: string; minor: number | null }>(),
        db.prepare(`SELECT currency, SUM(total_amount - amount_paid) AS minor FROM bookings WHERE status = 'confirmed' AND total_amount > amount_paid GROUP BY currency`).bind().all<{ currency: string; minor: number | null }>(),
        db.prepare(`SELECT COUNT(*) AS n FROM bookings WHERE status = 'confirmed' AND travel_date >= ? AND travel_date <= ?`).bind(opts.today, end30).first<{ n: number }>(),
      ]);
      return { by: Object.fromEntries(by.results.map((r) => [r.status, r.n])), paid: money(paid.results), balance: money(balance.results), trips: trips?.n ?? 0 };
    }),
    part('leads', { created: 0, stillOpen: 0, booked: 0, lost: 0, unassigned: 0, held: [] as Array<{ holder: string; n: number }> }, async () => {
      const q = async (where: string, ...args: unknown[]) => (await db.prepare(`SELECT COUNT(*) AS n FROM leads WHERE created_at >= ? AND ${where}`).bind(since30, ...args).first<{ n: number }>())?.n ?? 0;
      const [created, stillOpen, booked, lost, unassigned, held] = await Promise.all([
        q('1 = 1'),
        q(`status IN (${open})`, ...OPEN_STAGES),
        q(`status IN ('booked','converted')`),
        q(`status = 'lost'`),
        db.prepare(`SELECT COUNT(*) AS n FROM leads WHERE status IN (${open}) AND owner = ''`).bind(...OPEN_STAGES).first<{ n: number }>(),
        db.prepare(`SELECT owner AS holder, COUNT(*) AS n FROM leads WHERE status IN (${open}) AND owner != '' GROUP BY owner`).bind(...OPEN_STAGES).all<{ holder: string; n: number }>(),
      ]);
      return { created, stillOpen, booked, lost, unassigned: unassigned?.n ?? 0, held: held.results };
    }),
    part('chats', { started: 0, held: [] as Array<{ holder: string; n: number }> }, async () => {
      const [started, held] = await Promise.all([
        db.prepare(`SELECT COUNT(*) AS n FROM wa_conversations WHERE created_at >= ?`).bind(since30).first<{ n: number }>(),
        db.prepare(`SELECT handled_by AS holder, COUNT(*) AS n FROM wa_conversations WHERE handled_by != '' AND state != 'opted_out' GROUP BY handled_by`).bind().all<{ holder: string; n: number }>(),
      ]);
      return { started: started?.n ?? 0, held: held.results };
    }),
    part('reviews', 0, async () => (await db.prepare(`SELECT COUNT(*) AS n FROM tour_reviews WHERE status = 'pending'`).bind().first<{ n: number }>())?.n ?? 0),
  ]);

  const load = new Map<string, HolderLoad>();
  for (const r of leads.held) load.set(r.holder, { holder: r.holder, leads: r.n, chats: 0 });
  for (const r of chats.held) load.set(r.holder, { ...(load.get(r.holder) ?? { holder: r.holder, leads: 0, chats: 0 }), chats: r.n });

  return {
    today: opts.today,
    monthFrom: from,
    bookingsThisMonth: { confirmed: bookings.by.confirmed ?? 0, completed: bookings.by.completed ?? 0, cancelled: bookings.by.cancelled ?? 0, awaiting: bookings.by[AWAITING_STATUS] ?? 0 },
    paidThisMonth: bookings.paid,
    balanceOutstanding: bookings.balance,
    tripsNext30Days: bookings.trips,
    leads30: { created: leads.created, stillOpen: leads.stillOpen, booked: leads.booked, lost: leads.lost },
    leadsUnassigned: leads.unassigned,
    chats30: chats.started,
    reviewsToCheck: reviews,
    workload: [...load.values()].sort((a, b) => b.leads + b.chats - (a.leads + a.chats) || a.holder.localeCompare(b.holder)),
    failed,
  };
}
