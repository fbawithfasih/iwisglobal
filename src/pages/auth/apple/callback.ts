import type { APIRoute } from 'astro';
import { resolveEnv } from '../../../lib/env';
import { exchangeAppleCode } from '../../../lib/oauth/apple';
import { upsertCustomer } from '../../../lib/customers';
import { createCustomerSessionToken } from '../../../lib/customerAuth';
import { CUSTOMER_COOKIE, OAUTH_STATE_COOKIE, safeRedirectPath } from '../../../lib/requireCustomer';

export const prerender = false;

// Apple posts back here as `response_mode=form_post` (a cross-site POST,
// not a GET query string like Google's callback) — see buildAppleAuthorizeUrl.
export const POST: APIRoute = async ({ request, url, cookies, locals, redirect }) => {
  const env = resolveEnv(locals);
  const form = await request.formData();
  const code = form.get('code')?.toString();
  const state = form.get('state')?.toString();
  const formUser = form.get('user')?.toString() ?? null;
  const stateCookieRaw = cookies.get(OAUTH_STATE_COOKIE)?.value;
  cookies.delete(OAUTH_STATE_COOKIE, { path: '/auth' });

  try {
    const deniedReason = form.get('error')?.toString();
    if (deniedReason) throw new Error('Sign-in with Apple was cancelled.');
    if (!code || !state || !stateCookieRaw) throw new Error('Sign-in session expired. Please try again.');
    const parsedState = JSON.parse(stateCookieRaw);
    if (parsedState.nonce !== state) throw new Error('Sign-in session expired. Please try again.');
    const redirectTarget = safeRedirectPath(parsedState.redirect);

    const db = env.DB;
    if (!db || !env.CUSTOMER_SESSION_SECRET) throw new Error('Accounts are not available right now.');

    const profile = await exchangeAppleCode(env, code, `${url.origin}/auth/apple/callback`, formUser);
    const customer = await upsertCustomer(db, {
      provider: 'apple',
      providerSub: profile.providerSub,
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
    });

    const token = await createCustomerSessionToken(customer.id, env.CUSTOMER_SESSION_SECRET);
    cookies.set(CUSTOMER_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });

    return redirect(redirectTarget);
  } catch (error: any) {
    return redirect(`/login?error=${encodeURIComponent(error?.message || 'Sign-in failed. Please try again.')}`);
  }
};
