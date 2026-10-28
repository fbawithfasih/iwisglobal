// The pictures on the admin Private offers page (src/pages/admin/private-offers/index.astro): where each guest's offer stands,
// how long it has waited for a first payment, and which paid offers still need a person (a receipt email that never went out,
// or an offer that cannot be read). Pure functions over what the page already loads; counts only here, never money totals.

export type OfferStage = 'waiting' | 'deposit' | 'paid' | 'closed' | 'unreadable';

/** unpaid (open) = waiting for a first payment; unpaid and closed = closed; otherwise by what has been paid. */
export function offerStage(status: 'unpaid' | 'deposit_paid' | 'paid_in_full', closed: boolean): OfferStage {
  if (status === 'paid_in_full') return 'paid';
  if (status === 'deposit_paid') return 'deposit';
  return closed ? 'closed' : 'waiting';
}

export const WAITING_NUDGE_DAYS = 7;

/** Whole days since an offer was created; 0 for a bad or future date. */
export function ageDays(createdIso: string, nowMs: number): number {
  const ms = Date.parse(createdIso);
  return Number.isFinite(ms) ? Math.max(0, Math.floor((nowMs - ms) / 86_400_000)) : 0;
}

/** "Created today", "Created yesterday", "Created 9 days ago". */
export function ageLabel(days: number): string {
  return days === 0 ? 'Created today' : days === 1 ? 'Created yesterday' : `Created ${days} days ago`;
}

/** Paid payments whose owner email was never sent or is stuck mid-send (receipt_sent_at '' or 'pending:...'). */
export function receiptProblems(payments: { status: string; receiptSentAt: string }[]): number {
  return payments.filter((p) => p.status === 'paid' && (p.receiptSentAt === '' || p.receiptSentAt.startsWith('pending:'))).length;
}

/** How much of the trip total is paid, 0 to 100. 0 for an unknown total. */
export function paidPercent(paidMinor: number, totalMinor: number | undefined): number {
  if (!totalMinor || totalMinor <= 0 || paidMinor <= 0) return 0;
  return Math.min(100, Math.round((paidMinor / totalMinor) * 100));
}

export interface OfferMix { total: number; waiting: number; waitingLong: number; deposit: number; paid: number; closed: number; unreadable: number; receipts: number; needYou: number }

export function offerMix(rows: { stage: OfferStage; ageDays: number; receiptProblems: number }[]): OfferMix {
  const m: OfferMix = { total: rows.length, waiting: 0, waitingLong: 0, deposit: 0, paid: 0, closed: 0, unreadable: 0, receipts: 0, needYou: 0 };
  for (const r of rows) {
    m[r.stage] += 1;
    if (r.stage === 'waiting' && r.ageDays >= WAITING_NUDGE_DAYS) m.waitingLong += 1;
    if (r.receiptProblems > 0) m.receipts += 1;
  }
  m.needYou = m.receipts + m.unreadable;
  return m;
}
