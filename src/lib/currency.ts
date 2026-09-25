// Dual-currency (INR/USD) support. USD prices are set explicitly by the
// admin per tour/add-on (never auto-converted), so a NULL usdAmount means
// "no USD price set" and callers fall back to INR rather than guessing.

export type Currency = 'INR' | 'USD';

export const CURRENCY_SYMBOLS: Record<Currency, string> = { INR: '₹', USD: '$' };

export function resolveCurrency(searchParams: URLSearchParams, cookieValue?: string): Currency {
  const q = searchParams.get('currency');
  if (q === 'USD' || q === 'INR') return q;
  if (cookieValue === 'USD' || cookieValue === 'INR') return cookieValue;
  return 'INR';
}

export interface PricedItem {
  amount: number;
  usdAmount: number | null | undefined;
}

// Resolves the effective amount/currency for a priced item (tour or
// add-on) given the traveler's requested currency. Falls back to INR when
// USD was requested but no USD price has been set for this item.
export function resolvePrice(item: PricedItem, requested: Currency): { amount: number; currency: Currency } {
  if (requested === 'USD' && item.usdAmount != null) {
    return { amount: item.usdAmount, currency: 'USD' };
  }
  return { amount: item.amount, currency: 'INR' };
}

export interface PricedAddOn {
  id: string;
  name: string;
  amount: number;
  usdAmount?: number | null;
  includedByDefault?: boolean;
  perTraveler?: boolean;
}

// Resolves a tour's add-ons for a given (already-resolved) tour currency.
// An add-on without a USD price is simply left out when the effective
// currency is USD, rather than mixing currencies in one total.
export function resolveAddOns(
  addOns: PricedAddOn[],
  tourCurrency: Currency
): { id: string; name: string; amount: number; includedByDefault?: boolean; perTraveler?: boolean }[] {
  if (tourCurrency === 'USD') {
    return addOns
      .filter((a) => a.usdAmount != null)
      .map((a) => ({ id: a.id, name: a.name, amount: a.usdAmount as number, includedByDefault: a.includedByDefault, perTraveler: a.perTraveler }));
  }
  return addOns.map((a) => ({ id: a.id, name: a.name, amount: a.amount, includedByDefault: a.includedByDefault, perTraveler: a.perTraveler }));
}

export interface PricedTier {
  travelers: number;
  amount: number;
  usdAmount?: number | null;
}

// Resolves a tour's group-size pricing tiers (backlog 0.2) for a given
// (already-resolved) tour currency, same per-row fallback rule as
// resolveAddOns: a tier without a USD price is left out when the effective
// currency is USD, rather than mixing currencies. An empty result is
// expected and fine — callers fall back to the tour's flat amount.
export function resolvePricingTiers(tiers: PricedTier[], tourCurrency: Currency): { travelers: number; amount: number }[] {
  if (tourCurrency === 'USD') {
    return tiers.filter((t) => t.usdAmount != null).map((t) => ({ travelers: t.travelers, amount: t.usdAmount as number }));
  }
  return tiers.map((t) => ({ travelers: t.travelers, amount: t.amount }));
}

// The cheapest available per-person rate for a tour — the "From ₹X" price
// shown on cards and the tour page. With tiers, that's the largest-group
// tier's rate (not the flat amount, which would understate what a solo
// traveler actually pays and overstate what a group of 4 pays).
export function resolveFromPrice(
  tour: PricedItem & { pricingTiers?: PricedTier[] },
  requested: Currency
): { amount: number; currency: Currency } {
  const base = resolvePrice(tour, requested);
  const tiers = resolvePricingTiers(tour.pricingTiers ?? [], base.currency);
  if (tiers.length === 0) return base;
  return { amount: Math.min(...tiers.map((t) => t.amount)), currency: base.currency };
}

// Cheapest first by that same "From" price (in the visitor's currency), so
// listings lead with the entry-level tour. Used by /tours and the homepage.
export function sortByFromPrice<T extends PricedItem & { pricingTiers?: PricedTier[] }>(
  tours: T[],
  currency: Currency
): T[] {
  return [...tours].sort((a, b) => resolveFromPrice(a, currency).amount - resolveFromPrice(b, currency).amount);
}
