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
}

// Resolves a tour's add-ons for a given (already-resolved) tour currency.
// An add-on without a USD price is simply left out when the effective
// currency is USD, rather than mixing currencies in one total.
export function resolveAddOns(addOns: PricedAddOn[], tourCurrency: Currency): { id: string; name: string; amount: number }[] {
  if (tourCurrency === 'USD') {
    return addOns.filter((a) => a.usdAmount != null).map((a) => ({ id: a.id, name: a.name, amount: a.usdAmount as number }));
  }
  return addOns.map((a) => ({ id: a.id, name: a.name, amount: a.amount }));
}
