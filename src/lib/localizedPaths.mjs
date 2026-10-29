// Which pages have per-language URLs (/es/…, /fr/…, /de/…). Shared by the
// middleware, the layout (hreflang), the language switcher and the sitemap
// config, so it is plain .mjs (astro.config.mjs can import it).
//
// Only public, indexable content pages are listed. Account, sign-in, booking,
// review-link and API routes stay on a single URL and follow the language
// cookie, so their cookies, form posts and payment callbacks are untouched.

export const LOCALE_PREFIXES = ['es', 'fr', 'de'];

// Pages with exactly this path.
export const LOCALIZED_STATIC = [
  '/',
  '/tours',
  '/agra',
  '/guides',
  '/blog',
  '/compare',
  '/about',
  '/contact',
  '/help',
  '/no-commission-pledge',
  '/terms',
  '/privacy',
  '/impressum',
  '/cancellation-refund-policy',
  '/shipping-policy',
  '/reviews',
];

// Sections whose detail pages (/tours/<slug>, …) are localized too.
export const LOCALIZED_SECTIONS = ['/tours', '/agra', '/guides', '/blog'];

export function isLocalizedPath(path) {
  if (LOCALIZED_STATIC.includes(path)) return true;
  return LOCALIZED_SECTIONS.some((s) => path.startsWith(s + '/') && path.length > s.length + 1);
}

// '/es/tours' -> { locale: 'es', path: '/tours' }; '/es' -> { locale: 'es', path: '/' }
export function splitLocale(pathname) {
  const m = pathname.match(/^\/(es|fr|de)(\/.*)?$/);
  if (!m) return { locale: null, path: pathname };
  return { locale: m[1], path: m[2] && m[2] !== '/' ? m[2] : '/' };
}

// The URL path of a page in a language ('en' has no prefix).
export function localizedPath(path, locale) {
  if (!locale || locale === 'en') return path;
  return path === '/' ? `/${locale}` : `/${locale}${path}`;
}
