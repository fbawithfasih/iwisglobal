import type { ReportLine } from './leadReport';

// The pictures on the admin Lead report (src/pages/admin/leads/report.astro): the funnel from lead to booking, which channel brings the most,
// and where cost figures cannot be worked out because no spend was entered. Pure functions over the lines summarise() already builds.
// Counts and percentages only: the money columns stay in the tables below, as before.

export interface Totals { leads: number; quotes: number; deposits: number; bookings: number }

export function reportTotals(lines: Pick<ReportLine, 'leads' | 'quotes' | 'deposits' | 'bookings'>[]): Totals {
  return lines.reduce((t, l) => ({ leads: t.leads + l.leads, quotes: t.quotes + l.quotes, deposits: t.deposits + l.deposits, bookings: t.bookings + l.bookings }), { leads: 0, quotes: 0, deposits: 0, bookings: 0 });
}

/** A percentage with one decimal; 0 when there is nothing to divide by. */
export function percent(n: number, of: number): number {
  return of <= 0 ? 0 : Math.round((n / of) * 1000) / 10;
}

export interface FunnelStep { label: string; n: number; ofLeads: number; fromPrevious: number | null }

/** The four steps a lead can reach, each with its share of all leads and its share of the step before. */
export function funnel(t: Totals): FunnelStep[] {
  const steps: [string, number][] = [['Leads', t.leads], ['Quote sent', t.quotes], ['Deposit paid', t.deposits], ['Booked', t.bookings]];
  return steps.map(([label, n], i) => ({ label, n, ofLeads: percent(n, t.leads), fromPrevious: i === 0 ? null : percent(n, steps[i - 1][1]) }));
}

/** The line with the most leads (ties: the one with more bookings, then the name), or null when there are none. */
export function topLine(lines: Pick<ReportLine, 'key' | 'leads' | 'bookings'>[]): { key: string; leads: number; bookings: number } | null {
  const sorted = lines.filter((l) => l.leads > 0).sort((a, b) => b.leads - a.leads || b.bookings - a.bookings || a.key.localeCompare(b.key));
  return sorted[0] ? { key: sorted[0].key, leads: sorted[0].leads, bookings: sorted[0].bookings } : null;
}

/** Lines that have leads but no spend entered at all: their cost per lead and per booking cannot be worked out. */
export function withoutSpend(lines: Pick<ReportLine, 'key' | 'leads' | 'spend'>[]): string[] {
  return lines.filter((l) => l.leads > 0 && Object.keys(l.spend).length === 0).map((l) => l.key);
}

/** "45 min", "3 h", "2 d", or a dash. */
export function minutesLabel(m: number | null): string {
  return m == null ? '-' : m < 90 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
}

/** Bar width in percent: 0 for none, at least 4 so one is visible, 100 for the largest. */
export function barWidth(n: number, max: number): number {
  return n <= 0 || max <= 0 ? 0 : Math.max(4, Math.min(100, Math.round((n / max) * 100)));
}
