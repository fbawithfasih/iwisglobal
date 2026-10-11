export const LOCALE_PREFIXES: string[];
export const LOCALIZED_STATIC: string[];
export const LOCALIZED_SECTIONS: string[];
export function isLocalizedPath(path: string): boolean;
export function splitLocale(pathname: string): { locale: 'es' | 'fr' | 'de' | null; path: string };
export function localizedPath(path: string, locale?: string | null): string;
