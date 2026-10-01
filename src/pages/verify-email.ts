// The "Confirm your email" link lands here (src/lib/emailVerification.ts).
// It confirms the account's email and goes straight on to My Bookings, which
// then picks up any booking made with that email. Nothing renders here, so
// the token never reaches analytics as a page address.
import type { APIRoute } from 'astro';
import { resolveEnv } from '../lib/env';
import { confirmEmail } from '../lib/emailVerification';

export const prerender = false;

export const GET: APIRoute = async ({ url, locals, redirect }) => {
  const db = resolveEnv(locals).DB;
  const confirmed = db ? await confirmEmail(db, url.searchParams.get('t') ?? '') : null;
  return redirect(`/account/bookings?email=${confirmed ? 'confirmed' : 'link-expired'}`, 303);
};
