// Where the cookie banner is shown and analytics/advertising wait for a tap on Accept: the EU, the rest of the
// EEA, the UK and Switzerland (owner's decision, 25 Oct 2026). Everywhere else they are on by default and the
// visitor can switch them off with "Cookie settings"; an explicit choice (the cookie_consent cookie) always wins.
// The country comes from Cloudflare's cf-ipcountry header; an unknown or missing country counts as "ask first".

export const CONSENT_COUNTRIES = new Set([
  // EU 27
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  // rest of the EEA
  'IS', 'LI', 'NO',
  // UK and Switzerland
  'GB', 'CH',
]);

export function consentRequired(country: string | null | undefined): boolean {
  const c = (country ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c) || c === 'XX' || c === 'T1') return true; // unknown, or Tor
  return CONSENT_COUNTRIES.has(c);
}

// The visitor's effective choice for analytics and advertising: their own choice if they made one, otherwise
// "ask first" in the consent region and "on" elsewhere.
export function effectiveConsent(cookieHeader: string, country: string | null | undefined): 'granted' | 'denied' | 'ask' {
  const choice = /(?:^|;\s*)cookie_consent=(granted|denied)/.exec(cookieHeader)?.[1];
  if (choice === 'granted' || choice === 'denied') return choice;
  return consentRequired(country) ? 'ask' : 'granted';
}

// The visitor's country as Cloudflare sees it: request.cf.country in the Workers runtime, else the cf-ipcountry header.
export function requestCountry(request: Request, cf?: { country?: string } | null): string {
  return String(cf?.country ?? (request as Request & { cf?: { country?: string } }).cf?.country ?? request.headers.get('cf-ipcountry') ?? '');
}
