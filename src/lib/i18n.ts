// Site-chrome language switching. Mirrors currency.ts's resolveCurrency
// pattern exactly (query param → cookie → default), so the language and
// currency switcher (LocaleSwitcher.astro) can treat both the same way.
//
// Scope: translates persistent UI chrome (nav, homepage hero, trust
// badges) only. Tour listings/detail pages, the Help FAQ, and checkout
// stay English — that content lives in D1 with no per-locale columns, and
// translating admin-entered tour content is a separate, larger feature
// (either on-the-fly machine translation or an admin translation UI).

export type Locale = 'en' | 'es' | 'fr' | 'de';

export const LOCALES: { code: Locale; nativeLabel: string; label: string }[] = [
  { code: 'en', nativeLabel: 'English', label: 'English' },
  { code: 'es', nativeLabel: 'Español', label: 'Spanish' },
  { code: 'fr', nativeLabel: 'Français', label: 'French' },
  { code: 'de', nativeLabel: 'Deutsch', label: 'German' },
];

function isLocale(value: string | null | undefined): value is Locale {
  return value === 'en' || value === 'es' || value === 'fr' || value === 'de';
}

export function resolveLocale(searchParams: URLSearchParams, cookieValue?: string): Locale {
  const q = searchParams.get('lang');
  if (isLocale(q)) return q;
  if (isLocale(cookieValue)) return cookieValue;
  return 'en';
}

// The BCP 47 tag Intl and toLocale*String want for each site language.
const INTL: Record<Locale, string> = { en: 'en-GB', es: 'es-ES', fr: 'fr-FR', de: 'de-DE' };

export function intlLocale(locale: Locale): string {
  return INTL[locale];
}

// The language to write a stored booking's emails in (bookings.locale).
export function emailLocale(stored: string | null | undefined): Locale {
  return isLocale(stored) ? stored : 'en';
}
