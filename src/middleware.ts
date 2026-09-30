import { defineMiddleware } from 'astro:middleware';

// D1 read replication (turned on 30 Sep 2026): replicas only serve reads
// made through a session. Public pages may read from the nearest replica;
// admin, account, sign-in (and password reset), booking and API routes stay on the primary so a
// save or payment is never followed by a stale read. After any write (a
// non-GET request), the session's bookmark goes into a short-lived cookie so
// that visitor's next pages read at least that fresh ("read your writes").
const PRIMARY_PATHS = /^\/(admin|account|auth|login|signup|forgot-password|reset-password|booking|api)(\/|$)/;
const BOOKMARK_COOKIE = 'd1_bookmark';

type Session = { getBookmark(): string | null };
type ReplicatedDb = { withSession(constraintOrBookmark?: string): Session };

export const onRequest = defineMiddleware(async (context, next) => {
  // Every page is server-rendered and BaseLayout builds its canonical from the
  // request path, so /help and /help/ both answered 200 and each claimed to be
  // canonical. One URL per page: 301 any trailing-slash path to its bare form.
  const { pathname, search } = context.url;
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return context.redirect(pathname.replace(/\/+$/, '') + search, 301);
  }

  // locals.runtime is built fresh per request by the Cloudflare adapter; its
  // env is shared, so swap in a copy rather than mutating it.
  const runtime = (context.locals as { runtime?: { env?: Record<string, unknown> } }).runtime;
  const db = runtime?.env?.DB as Partial<ReplicatedDb> | undefined;
  if (!runtime?.env || typeof db?.withSession !== 'function') return next();

  const start = PRIMARY_PATHS.test(pathname)
    ? 'first-primary'
    : (context.cookies.get(BOOKMARK_COOKIE)?.value ?? 'first-unconstrained');
  const session = db.withSession(start);
  runtime.env = { ...runtime.env, DB: session };

  const response = await next();

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
