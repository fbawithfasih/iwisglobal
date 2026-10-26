import type { APIRoute } from 'astro';
import { resolveEnv } from '../../../../lib/env';
import { exchangeGoogleCode } from '../../../../lib/oauth/google';
import { completeStaffSignIn, SESSION_TTL_MS, STAFF_COOKIE, STAFF_STATE_COOKIE } from '../../../../lib/staff';
import { auditContext, recordAudit } from '../../../../lib/audit';

export const prerender = false;

// Finishes staff sign-in with Google. Only an address the owner invited gets a session; everyone else is sent back to
// the login page with a short code (never free text) and the attempt is written to the audit log.
export const GET: APIRoute = async ({ url, cookies, locals, request, redirect }) => {
  const env = resolveEnv(locals);
  const db = env.DB;
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expected = cookies.get(STAFF_STATE_COOKIE)?.value;
  cookies.delete(STAFF_STATE_COOKIE, { path: '/admin' });
  const back = (error: string) => redirect(`/admin/login?error=${error}`);

  if (url.searchParams.get('error')) return back('cancelled');
  if (!code || !state || !expected || state !== expected) return back('expired');
  if (!db) return back('unavailable');

  try {
    const profile = await exchangeGoogleCode(env, code, `${url.origin}/admin/auth/google/callback`);
    const result = await completeStaffSignIn(db, profile, { ip: request.headers.get('cf-connecting-ip'), userAgent: request.headers.get('user-agent') });
    if (!result.ok) {
      await recordAudit(db, auditContext(request, 'anonymous'), { action: 'auth.staff_denied', resource: 'session', summary: `Google sign-in refused (${result.reason})`, meta: { email: profile.email.slice(0, 120) } });
      return back(result.reason === 'suspended' || result.reason === 'expired_invite' ? result.reason : 'not_invited');
    }
    cookies.set(STAFF_COOKIE, result.token, { httpOnly: true, secure: true, sameSite: 'lax', path: '/admin', maxAge: Math.floor(SESSION_TTL_MS / 1000) });
    await recordAudit(db, auditContext(request, result.user.email), { action: 'auth.staff_login', resource: 'session', summary: 'Signed in with Google' });
    return redirect('/admin');
  } catch (err) {
    console.error('staff google sign-in failed', err instanceof Error ? err.message : 'error');
    return back('failed');
  }
};
