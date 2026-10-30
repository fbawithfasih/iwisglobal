// Pure pricing and payment-plan rules for private offer pages.
// No imports, no network, no database. planPayment never throws.

export type GuideLanguage = 'en' | 'de';
export type PaymentKind = 'full' | 'deposit' | 'balance';
export interface OfferOption { id: string; label: string; vehicle: string; totalMinor: number }
export interface OfferTerms {
  currency: 'EUR' | 'USD' | 'INR';
  options: OfferOption[];
  depositPercent: number;
  germanGuideExtraMinor: number;
  // Per-offer switches (content flags): the guest must pay in full to confirm (no booking amount), and/or the guide is English only.
  fullPaymentOnly?: boolean;
  englishGuideOnly?: boolean;
}
export interface PaidPayment { optionId: string; guideLanguage: GuideLanguage; kind: PaymentKind; amountMinor: number }

export function tripTotalMinor(terms: OfferTerms, optionId: string, lang: GuideLanguage): number | null {
  const opt = terms.options.find((o) => o.id === optionId);
  if (!opt) return null;
  return opt.totalMinor + (lang === 'de' ? terms.germanGuideExtraMinor : 0);
}

export function depositMinor(totalMinor: number, percent: number): number {
  return Math.round((totalMinor * percent) / 100);
}

export type PlanError = 'bad_option' | 'bad_language' | 'bad_mode' | 'bad_terms' | 'already_paid' | 'deposit_first' | 'nothing_due';
export type PlanResult =
  | { ok: true; kind: PaymentKind; optionId: string; guideLanguage: GuideLanguage; amountMinor: number; totalMinor: number }
  | { ok: false; error: PlanError };

const fail = (error: PlanError): PlanResult => ({ ok: false, error });
const isPosInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0;

export function planPayment(
  terms: OfferTerms,
  paid: PaidPayment[],
  req: { mode: unknown; optionId?: unknown; guideLanguage?: unknown },
): PlanResult {
  try {
    const dp = terms?.depositPercent;
    if (
      typeof dp !== 'number' || !Number.isInteger(dp) || dp < 1 || dp > 99 ||
      !Array.isArray(terms.options) ||
      !terms.options.every((o) => o && isPosInt(o.totalMinor)) ||
      !Number.isInteger(terms.germanGuideExtraMinor) || terms.germanGuideExtraMinor < 0
    ) return fail('bad_terms');

    const payments = Array.isArray(paid) ? paid : [];
    const mode = req?.mode;
    const done = payments.some((p) => p.kind === 'full' || p.kind === 'balance');
    const deposit = payments.find((p) => p.kind === 'deposit');

    if (done) return fail('already_paid');

    if (deposit) {
      if (mode !== 'balance') {
        return mode === 'full' || mode === 'deposit' ? fail('already_paid') : fail('bad_mode');
      }
      const total = tripTotalMinor(terms, deposit.optionId, deposit.guideLanguage);
      if (total === null) return fail('bad_option');
      const due = total - payments.filter((p) => p.kind === 'deposit').reduce((s, p) => s + p.amountMinor, 0);
      if (due <= 0) return fail('nothing_due');
      return { ok: true, kind: 'balance', optionId: deposit.optionId, guideLanguage: deposit.guideLanguage, amountMinor: due, totalMinor: total };
    }

    if (mode === 'balance') return fail('deposit_first');
    if (mode !== 'full' && mode !== 'deposit') return fail('bad_mode');
    if (mode === 'deposit' && terms.fullPaymentOnly === true) return fail('bad_mode');

    const optionId = req.optionId;
    if (typeof optionId !== 'string' || !terms.options.some((o) => o.id === optionId)) return fail('bad_option');
    const lang = req.guideLanguage;
    if (lang !== 'en' && lang !== 'de') return fail('bad_language');
    if (lang === 'de' && terms.englishGuideOnly === true) return fail('bad_language');

    const total = tripTotalMinor(terms, optionId, lang);
    if (total === null) return fail('bad_option');
    const amountMinor = mode === 'full' ? total : depositMinor(total, dp);
    if (!Number.isInteger(total) || !Number.isInteger(amountMinor) || amountMinor <= 0) return fail('bad_terms');
    return { ok: true, kind: mode, optionId, guideLanguage: lang, amountMinor, totalMinor: total };
  } catch {
    return fail('bad_terms');
  }
}

export type OfferState = {
  status: 'unpaid' | 'deposit_paid' | 'paid_in_full';
  optionId?: string;
  guideLanguage?: GuideLanguage;
  totalMinor?: number;
  paidMinor: number;
  balanceMinor: number;
};

export function offerState(terms: OfferTerms, paid: PaidPayment[]): OfferState {
  if (!paid.length) return { status: 'unpaid', paidMinor: 0, balanceMinor: 0 };
  const first = paid[0];
  const paidMinor = paid.reduce((s, p) => s + p.amountMinor, 0);
  const totalMinor = tripTotalMinor(terms, first.optionId, first.guideLanguage) ?? undefined;
  const done = paid.some((p) => p.kind === 'full' || p.kind === 'balance');
  const base = { optionId: first.optionId, guideLanguage: first.guideLanguage, totalMinor, paidMinor };
  if (done) return { status: 'paid_in_full', ...base, balanceMinor: 0 };
  return { status: 'deposit_paid', ...base, balanceMinor: Math.max(0, (totalMinor ?? paidMinor) - paidMinor) };
}
