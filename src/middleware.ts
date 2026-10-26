import { defineMiddleware } from 'astro:middleware';
import { isLocalizedPath, splitLocale, localizedPath } from './lib/localizedPaths.mjs';
import type { Locale } from './lib/i18n';
import { isBlockedPath } from './lib/blockedPaths';
import { adminGate } from './lib/adminGate';
import { resolveEnv } from './lib/env';

// D1 read replication (turned on 30 Sep 2026): replicas only serve reads
// made through a session. Public pages may read from the nearest replica;
// admin, account, sign-in (and password reset), booking, private offer pages (/offer/<id>) and API routes (which already covers /api/offer/*) stay on the primary so a
// save or payment is never followed by a stale read. After any write (a
// non-GET request), the session's bookmark goes into a short-lived cookie so
// that visitor's next pages read at least that fresh ("read your writes").
const PRIMARY_PATHS = /^\/(admin|account|auth|login|signup|forgot-password|reset-password|verify-email|confirm-subscription|unsubscribe|booking|offer|api|r)(\/|$)/;
const BOOKMARK_COOKIE = 'd1_bookmark';

type Session = { getBookmark(): string | null };
type ReplicatedDb = { withSession(constraintOrBookmark?: string): Session };

export const onRequest = defineMiddleware(async (context, next) => {
  // Framework endpoints this site does not use (see src/lib/blockedPaths.ts): refused before any routing.
  if (isBlockedPath(context.url.pathname)) {
    return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  // Every page is server-rendered and BaseLayout builds its canonical from the
  // request path, so /help and /help/ both answered 200 and each claimed to be
  // canonical. One URL per page: 301 any trailing-slash path to its bare form.
  const { pathname, search } = context.url;
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return context.redirect(pathname.replace(/\/+$/, '') + search, 301);
  }

  // Language URLs: /es/…, /fr/…, /de/… serve the normal page in that language.
  // English has no prefix. See src/lib/localizedPaths.mjs for which pages.
  const isRead = context.request.method === 'GET' || context.request.method === 'HEAD';
  const split = splitLocale(pathname);
  const langParam = context.url.searchParams.get('lang');
  const cookieLang = context.cookies.get('lang')?.value;
  const LANG_COOKIE = { path: '/', maxAge: 60 * 60 * 24 * 365 } as const;
  const isLang = (v: string | null | undefined): v is Locale => v === 'en' || v === 'es' || v === 'fr' || v === 'de';
  let rewriteTo: string | undefined;
  let prefixLinksWith: string | null = null;

  if (isRead && isLocalizedPath(split.path)) {
    if (isLang(langParam)) {
      // Old ?lang= links and the English switcher link: go to the clean URL.
      const rest = new URLSearchParams(context.url.searchParams);
      rest.delete('lang');
      const qs = rest.toString();
      const res = context.redirect(localizedPath(split.path, langParam) + (qs ? '?' + qs : ''), 302);
      res.headers.append('Set-Cookie', `lang=${langParam}; Path=/; Max-Age=${LANG_COOKIE.maxAge}; SameSite=Lax`);
      return res;
    }
    if (split.locale) {
      context.locals.locale = split.locale;
      context.locals.canonicalPath = split.path;
      if (cookieLang !== split.locale) context.cookies.set('lang', split.locale, LANG_COOKIE);
      rewriteTo = split.path + search;
      prefixLinksWith = split.locale;
    } else if (isLang(cookieLang) && cookieLang !== 'en') {
      // A visitor who chose a language earlier lands on that language's URL.
      return context.redirect(localizedPath(split.path, cookieLang) + search, 302);
    } else {
      context.locals.locale = 'en';
      context.locals.canonicalPath = split.path;
    }
  } else if (split.locale) {
    // /es/login and the like: those pages have one URL.
    return context.redirect(split.path + search, 302);
  }
  const proceed = async () => {
    const response = rewriteTo ? await next(rewriteTo) : await next();
    if (!prefixLinksWith || !(response.headers.get('content-type') ?? '').includes('text/html')) return response;
    // Keep visitors in their language: point internal links at the prefixed URLs.
    const html = (await response.text()).replace(/href="(\/[^"?#]*)([?#][^"]*)?"/g, (m, path: string, rest = '') =>
      !path.startsWith('//') && isLocalizedPath(path) ? `href="${localizedPath(path, prefixLinksWith)}${rest}"` : m
    );
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    return new Response(html, { status: response.status, statusText: response.statusText, headers });
  };

  // Every /admin request is identified and checked here before any page runs (second layer; pages still check themselves).
  // It runs after the database session below is set up, so a suspended person is refused on the very next request.
  // Admin responses carry Server-Timing (milliseconds spent in our code, database included) so page speed can be read
  // in the browser's network panel. Workers clocks move only when I/O completes, so this is the time spent waiting on D1 and fetches.
  const guarded = async () => {
    const t0 = Date.now();
    const response = (await adminGate(context, resolveEnv(context.locals))) ?? (await proceed());
    if (context.url.pathname.startsWith('/admin')) {
      try { response.headers.set('Server-Timing', `app;dur=${Date.now() - t0}`); } catch { /* redirect responses have immutable headers */ }
    }
    return response;
  };

  // locals.runtime is built fresh per request by the Cloudflare adapter; its
  // env is shared, so swap in a copy rather than mutating it.
  const runtime = (context.locals as { runtime?: { env?: Record<string, unknown> } }).runtime;
  const db = runtime?.env?.DB as Partial<ReplicatedDb> | undefined;
  if (!runtime?.env || typeof db?.withSession !== 'function') return guarded();

  const start = PRIMARY_PATHS.test(pathname)
    ? 'first-primary'
    : (context.cookies.get(BOOKMARK_COOKIE)?.value ?? 'first-unconstrained');
  const session = db.withSession(start);
  runtime.env = { ...runtime.env, DB: session };

  const response = await guarded();

  const method = context.request.method;
  const bookmark = session.getBookmark();
  if (method !== 'GET' && method !== 'HEAD' && bookmark) {
    response.headers.append(
      'Set-Cookie',
      `${BOOKMARK_COOKIE}=${encodeURIComponent(bookmark)}; Path=/; Max-Age=300; HttpOnly; Secure; SameSite=Lax`
    );
  }
  return response;
});
