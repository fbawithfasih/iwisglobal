import type { APIRoute } from 'astro';
import { resolveEnv } from '../../../lib/env';
import { exchangeGoogleCode } from '../../../lib/oauth/google';
import { upsertCustomer } from '../../../lib/customers';
import { createCustomerSessionToken } from '../../../lib/customerAuth';
import { CUSTOMER_COOKIE, OAUTH_STATE_COOKIE, safeRedirectPath, SignInError } from '../../../lib/requireCustomer';

export const prerender = false;

export const GET: APIRoute = async ({ url, cookies, locals, redirect }) => {
  const env = resolveEnv(locals);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const stateCookieRaw = cookies.get(OAUTH_STATE_COOKIE)?.value;
  cookies.delete(OAUTH_STATE_COOKIE, { path: '/auth' });

  try {
    if (!code || !state || !stateCookieRaw) throw new SignInError('expired');
    const parsedState = JSON.parse(stateCookieRaw);
    if (parsedState.nonce !== state) throw new SignInError('expired');
    const redirectTarget = safeRedirectPath(parsedState.redirect);

    const db = env.DB;
    if (!db || !env.CUSTOMER_SESSION_SECRET) throw new SignInError('unavailable');

    const profile = await exchangeGoogleCode(env, code, `${url.origin}/auth/google/callback`);
    const customer = await upsertCustomer(db, {
      provider: 'google',
      providerSub: profile.providerSub,
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
      emailVerified: profile.emailVerified,
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
  } catch (error) {
    if (!(error instanceof SignInError)) console.error('google sign-in failed:', error);
    return redirect(`/login?error=${error instanceof SignInError ? error.code : 'failed'}`);
  }
};
