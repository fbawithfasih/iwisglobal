import type { APIRoute } from 'astro';
import { resolveEnv } from '../../../../lib/env';
import { buildGoogleAuthorizeUrl } from '../../../../lib/oauth/google';
import { STAFF_STATE_COOKIE } from '../../../../lib/staff';

export const prerender = false;

// Starts staff sign-in with Google. The redirect address /admin/auth/google/callback must be listed as an authorised
// redirect URI on the same Google OAuth client the customer sign-in uses.
export const GET: APIRoute = async ({ url, cookies, locals, redirect }) => {
  const env = resolveEnv(locals);
  const nonce = crypto.randomUUID();
  try {
    const target = buildGoogleAuthorizeUrl(env, `${url.origin}/admin/auth/google/callback`, nonce);
    cookies.set(STAFF_STATE_COOKIE, nonce, { httpOnly: true, secure: true, sameSite: 'lax', path: '/admin', maxAge: 60 * 10 });
    return redirect(target);
  } catch {
    return redirect('/admin/login?error=google_unavailable');
  }
};
