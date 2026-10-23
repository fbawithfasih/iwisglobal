import type { D1Like } from './db';

// Source-to-booking report: where leads come from and what they turn into. Built from the leads table (stage,
// booking link) plus hand-entered marketing spend, so cost per lead and per booking are honest about what was typed in.

export interface ReportLead {
  channel: string;
  campaign: string;
  status: string;
  created_at: string;
  first_response_at: string | null;
  booking_id: string | null;
  amount_paid: number | null;
  currency: string | null;
}

export interface SpendRow {
  id?: number;
  spend_date?: string;
  channel: string;
  campaign: string;
  amount_minor: number;
  currency: string;
  note?: string;
}

export interface ReportLine {
  key: string;
  leads: number;
  quotes: number;
  deposits: number;
  bookings: number;
  revenue: Record<string, number>; // currency -> minor units
  spend: Record<string, number>; // currency -> minor units
  medianResponseMinutes: number | null;
}

const QUOTE = new Set(['quote_sent', 'deposit_paid', 'booked', 'converted']);
const DEPOSIT = new Set(['deposit_paid', 'booked', 'converted']);
const BOOKED = new Set(['booked', 'converted']);

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

// Groups leads (and spend) by channel or campaign. A lead counts at every stage it has reached, not just the last.
export function summarise(leads: ReportLead[], spend: SpendRow[], by: 'channel' | 'campaign'): ReportLine[] {
  const lines = new Map<string, ReportLine & { waits: number[] }>();
  const line = (key: string) => {
    let l = lines.get(key);
    if (!l) {
      l = { key, leads: 0, quotes: 0, deposits: 0, bookings: 0, revenue: {}, spend: {}, medianResponseMinutes: null, waits: [] };
      lines.set(key, l);
    }
    return l;
  };
  for (const r of leads) {
    if (r.status === 'spam') continue;
    const l = line((by === 'channel' ? r.channel : r.campaign) || (by === 'channel' ? 'unknown' : '(no campaign)'));
    const booked = BOOKED.has(r.status) || !!r.booking_id;
    l.leads++;
    if (QUOTE.has(r.status) || booked) l.quotes++;
    if (DEPOSIT.has(r.status) || booked) l.deposits++;
    if (booked) l.bookings++;
    if (r.booking_id && r.amount_paid != null && r.currency) l.revenue[r.currency] = (l.revenue[r.currency] ?? 0) + r.amount_paid;
    if (r.first_response_at) {
      const wait = (Date.parse(r.first_response_at) - Date.parse(r.created_at)) / 60000;
      if (Number.isFinite(wait) && wait >= 0) l.waits.push(wait);
    }
  }
  for (const s of spend) {
    const key = (by === 'channel' ? s.channel : s.campaign) || (by === 'channel' ? 'unknown' : '(no campaign)');
    const l = line(key);
    l.spend[s.currency] = (l.spend[s.currency] ?? 0) + s.amount_minor;
  }
  return [...lines.values()]
    .map(({ waits, ...l }) => ({ ...l, medianResponseMinutes: median(waits) }))
    .sort((a, b) => b.leads - a.leads || a.key.localeCompare(b.key));
}

// Cost per lead / booking in each currency that has spend (integer minor units, rounded); null when there is nothing to divide by.
export function unitCost(spend: Record<string, number>, count: number): Record<string, number> | null {
  if (count <= 0) return null;
  const out: Record<string, number> = {};
  for (const [cur, minor] of Object.entries(spend)) out[cur] = Math.round(minor / count);
  return Object.keys(out).length > 0 ? out : null;
}

export async function loadReport(db: D1Like, fromDay: string, toDay: string): Promise<{ leads: ReportLead[]; spend: SpendRow[] }> {
  const from = `${fromDay}T00:00:00.000Z`;
  const to = `${toDay}T23:59:59.999Z`;
  const leads = (
    await db
      .prepare(
        `SELECT l.channel, l.campaign, l.status, l.created_at, l.first_response_at, l.booking_id, b.amount_paid, b.currency
           FROM leads l LEFT JOIN bookings b ON b.id = l.booking_id
          WHERE l.created_at >= ? AND l.created_at <= ? LIMIT 20000`
      )
      .bind(from, to)
      .all<ReportLead>()
  ).results;
  const spend = (
    await db
      .prepare(`SELECT id, spend_date, channel, campaign, amount_minor, currency, note FROM marketing_spend WHERE spend_date >= ? AND spend_date <= ? ORDER BY spend_date DESC, id DESC LIMIT 500`)
      .bind(fromDay, toDay)
      .all<SpendRow>()
  ).results;
  return { leads, spend };
}

export async function addSpend(db: D1Like, s: { date: string; channel: string; campaign: string; amountMajor: number; currency: string; note: string }): Promise<string | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date)) return 'Enter a valid date.';
  if (!s.channel.trim()) return 'Enter the channel (for example facebook_ads).';
  if (!Number.isFinite(s.amountMajor) || s.amountMajor <= 0 || s.amountMajor > 100_000_000) return 'Enter an amount above zero.';
  if (!['INR', 'USD', 'EUR', 'GBP'].includes(s.currency)) return 'Choose a currency.';
  await db
    .prepare(`INSERT INTO marketing_spend (spend_date, channel, campaign, amount_minor, currency, note) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(s.date, s.channel.trim().toLowerCase().slice(0, 60), s.campaign.trim().slice(0, 80), Math.round(s.amountMajor * 100), s.currency, s.note.trim().slice(0, 200))
    .run();
  return null;
}

export async function deleteSpend(db: D1Like, id: number): Promise<void> {
  await db.prepare(`DELETE FROM marketing_spend WHERE id = ?`).bind(id).run();
}
