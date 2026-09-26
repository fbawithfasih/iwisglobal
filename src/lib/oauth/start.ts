import type { AstroCookies } from 'astro';
import { OAUTH_STATE_COOKIE } from '../requireCustomer';
import { buildGoogleAuthorizeUrl } from './google';
import { buildAppleAuthorizeUrl } from './apple';

// Starts Google/Apple sign-in for a page that shows the buttons (sign-in and
// sign-up): sets the state cookie and returns each provider's authorize URL,
// or null for a provider that isn't set up (missing keys) — that provider is
// then left off the page, and the reason goes to the server log.
export function startOAuthSignIn(
  env: Record<string, unknown>,
  cookies: AstroCookies,
  origin: string,
  redirect: string
): { googleUrl: string | null; appleUrl: string | null } {
  // CSRF nonce for the OAuth `state` param, paired with where to send the
  // customer back to once sign-in completes. SameSite=None because Apple's
  // callback is a cross-site POST (form_post) — Lax cookies aren't sent on
  // cross-site POST navigations, only top-level GETs like Google's callback.
  const nonce = crypto.randomUUID();
  cookies.set(OAUTH_STATE_COOKIE, JSON.stringify({ nonce, redirect }), {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/auth',
    maxAge: 60 * 10,
  });

  let googleUrl: string | null = null;
  try {
    googleUrl = buildGoogleAuthorizeUrl(env, `${origin}/auth/google/callback`, nonce);
  } catch (e: any) {
    console.warn('sign-in: Google unavailable:', e.message);
  }

  let appleUrl: string | null = null;
  try {
    appleUrl = buildAppleAuthorizeUrl(env, `${origin}/auth/apple/callback`, nonce);
  } catch (e: any) {
    console.warn('sign-in: Apple unavailable:', e.message);
  }

  return { googleUrl, appleUrl };
}
