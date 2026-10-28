// The pictures on the admin Hotels page (src/pages/admin/hotels/index.astro): what is left before hotels can go live, how fresh the loaded
// content is, and how the paid bookings stand. Pure functions over what the page already reads; nothing here prints a key or a secret.

export interface SetupInput {
  enabled: boolean;
  markupPercent: number;
  fxEurInr: number;
  fxEurUsd: number;
  hotelCount: number;
  keysConfigured: boolean;
}
export interface SetupItem { key: string; label: string; done: boolean; hint: string }

/** The things hotels need before they can be switched on, and the one that stops USD guests, in the order to do them. */
export function setupChecklist(s: SetupInput): SetupItem[] {
  return [
    { key: 'keys', label: 'Hotelbeds keys are set', done: s.keysConfigured, hint: 'Add the API key and secret in Cloudflare.' },
    { key: 'content', label: 'Hotel content is loaded', done: s.hotelCount > 0, hint: 'Press Refresh content.' },
    { key: 'markup', label: 'Markup is above 0', done: s.markupPercent > 0, hint: 'Set it under Pricing and filters.' },
    { key: 'inr', label: 'EUR to INR rate is set', done: s.fxEurInr > 0, hint: 'Set it under Pricing and filters.' },
    { key: 'usd', label: 'EUR to USD rate is set', done: s.fxEurUsd > 0, hint: 'While it is 0, guests who pay in dollars see no hotels.' },
    { key: 'on', label: 'Hotels are switched on', done: s.enabled, hint: 'Switch on when the rest is ticked.' },
  ];
}

export type RefreshState = 'never' | 'error' | 'fresh' | 'soon' | 'old';

/** A refresh within 7 days is fresh, within 30 days is due soon, older is old. A recorded error wins; no run at all is "never". */
export function refreshFreshness(lastRun: string | null, lastError: string | null, nowMs: number): { state: RefreshState; days: number | null } {
  const ms = lastRun ? Date.parse(lastRun) : NaN;
  const days = Number.isFinite(ms) ? Math.max(0, Math.floor((nowMs - ms) / 86_400_000)) : null;
  if (lastError && lastError.trim() !== '') return { state: 'error', days };
  if (days === null) return { state: 'never', days: null };
  return { state: days <= 7 ? 'fresh' : days <= 30 ? 'soon' : 'old', days };
}

export interface BookingMix { booked: number; cancelled: number; failed: number; stuck: number; waiting: number; total: number }

/** Paid hotel bookings by where they stand. "stuck" is paid but not confirmed with Hotelbeds for too long: those need a person. */
export function bookingMix(rows: { status: string; stuck: boolean }[]): BookingMix {
  const m: BookingMix = { booked: 0, cancelled: 0, failed: 0, stuck: 0, waiting: 0, total: rows.length };
  for (const r of rows) {
    if (r.status === 'booked') m.booked += 1;
    else if (r.status === 'cancelled') m.cancelled += 1;
    else if (r.status === 'failed') m.failed += 1;
    else if (r.status === 'paid') (r.stuck ? (m.stuck += 1) : (m.waiting += 1));
  }
  return m;
}
