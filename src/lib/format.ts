import { CURRENCY_SYMBOLS, type Currency } from './currency';

// Display formatting for dates and stored amounts (admin pages).

// "Sat, 10 Oct 2026" from a YYYY-MM-DD travel date (a calendar date, so UTC
// avoids any time-zone shift).
export function formatTravelDate(ymd: string, tag = 'en-GB'): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString(tag, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// "₹13,258" / "$70" from an amount stored in the smallest unit (paise/cents).
export function formatMoneyMinor(minor: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency as Currency] ?? `${currency} `;
  return `${symbol}${(minor / 100).toLocaleString(currency === 'USD' ? 'en-US' : 'en-IN')}`;
}

// "27 Sept 2026, 5:30 am" in India time from an ISO timestamp.
export function formatDateTimeIst(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : '';
}
