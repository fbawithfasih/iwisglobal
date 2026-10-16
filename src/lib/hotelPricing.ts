// Hotel prices: what the guest pays, and what comes back on a cancellation.
// Pure, so the server and the tests share one set of rules.

export type GuestCurrency = 'INR' | 'USD';

export interface PricingSettings {
  markupPercent: number;
  fxEurInr: number;
  fxEurUsd: number;
  contractCurrency: string;
}

// Net + markup, converted, rounded up to a whole unit. Null when Hotelbeds
// quotes in a currency we have no rate for.
export function guestPrice(net: number, hbCurrency: string, target: GuestCurrency, s: PricingSettings): number | null {
  if (hbCurrency !== 'EUR' || s.contractCurrency !== 'EUR') return null;
  const rate = target === 'INR' ? s.fxEurInr : s.fxEurUsd;
  if (!(rate > 0) || !(net >= 0)) return null;
  const value = net * (1 + s.markupPercent / 100) * rate;
  return Math.ceil(Math.round(value * 1000) / 1000);
}

// Hotelbeds cancellation policy: from this moment on, cancelling costs `amount`
// (net currency). Later entries replace earlier ones.
export interface CancellationPolicy {
  amount: number;
  from: string;
}

export function cancellationFeeNet(policies: CancellationPolicy[], at: Date): number {
  let fee = 0;
  const sorted = [...policies].sort((a, b) => Date.parse(a.from) - Date.parse(b.from));
  for (const p of sorted) if (Date.parse(p.from) <= at.getTime()) fee = Math.max(fee, p.amount);
  return fee;
}

// The guest bears the fee in proportion to the price they paid, so the markup
// is refunded in step with the hotel's share.
export function guestRefund(sellTotal: number, netCost: number, policies: CancellationPolicy[], at: Date): number {
  if (!(netCost > 0)) return 0;
  const ratio = Math.min(1, cancellationFeeNet(policies, at) / netCost);
  return Math.max(0, sellTotal - Math.ceil(sellTotal * ratio));
}
