// Translated UI strings (see src/lib/i18n.ts for scope). One file per
// language; the English file defines the shape every other language must
// match, so a missing key is a type error (npx astro check), not a blank on
// the page. These are machine translations, not reviewed by a native speaker,
// so worth a native-speaker pass before treating them as final, especially
// anywhere near pricing and policy language.

import { resolveLocale, type Locale } from '../lib/i18n';
import { en, type Dictionary } from './en';
import { es } from './es';
import { fr } from './fr';
import { de } from './de';

export type { Dictionary };

const dictionaries: Record<Locale, Dictionary> = { en, es, fr, de };

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}

export { fmt } from './fmt';

// What a page needs from the request: its locale and that locale's strings.
// Pages call this in their frontmatter; BaseLayout resolves the same locale
// for the shared header and footer.
export function pageI18n(Astro: { url: URL; cookies: { get(name: string): { value: string } | undefined } }) {
  const locale = resolveLocale(Astro.url.searchParams, Astro.cookies.get('lang')?.value);
  return { locale, t: getDictionary(locale) };
}

// "English" as stored on a tour -> the name in the visitor's language
// (falls back to the stored text for a language we have no entry for).
export function languageName(t: Dictionary, stored: string): string {
  return (t.languages as Record<string, string>)[stored] ?? stored;
}
