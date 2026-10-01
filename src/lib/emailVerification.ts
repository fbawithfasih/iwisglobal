// Confirmed account emails (schema_email_verification.sql), and linking
// guest bookings to accounts. A booking made without signing in carries only
// the traveler's email; it joins an account once that account has proven it
// owns the email (Google/Apple at sign-in, a "Confirm your email" link, or a
// completed password reset). Linking on email alone would let anyone sign up
// with a guest's address and see their bookings.
import type { D1Like } from './db';
import type { CustomerRow } from './customers';
import { newLinkToken, hashLinkToken } from './oneTimeLinks';

const LINK_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_LINKS_PER_HOUR = 3;

export async function markEmailVerified(db: D1Like, customerId: string): Promise<void> {
  await db
    .prepare(`UPDATE customers SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?`)
    .bind(new Date().toISOString(), customerId)
    .run();
}

// Attaches the account's not-yet-linked bookings made with its (confirmed)
// email. Safe to run on every visit to My Bookings: it only ever claims
// bookings no account owns yet.
export async function linkGuestBookings(db: D1Like, customer: Pick<CustomerRow, 'id' | 'email' | 'email_verified_at'>): Promise<void> {
  if (!customer.email_verified_at) return;
  await db
    .prepare(`UPDATE bookings SET customer_id = ? WHERE customer_id IS NULL AND lower(traveler_email) = lower(?)`)
    .bind(customer.id, customer.email)
    .run();
}

// A new confirmation link, or null if the account asked for too many in the
// last hour.
export async function createEmailVerificationLink(db: D1Like, customerId: string, site: string): Promise<string | null> {
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recent = await db
    .prepare(`SELECT COUNT(*) AS n FROM email_verifications WHERE customer_id = ? AND created_at > ?`)
    .bind(customerId, hourAgo)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= MAX_LINKS_PER_HOUR) return null;

  const token = newLinkToken();
  const now = new Date();
  await db
    .prepare(`INSERT INTO email_verifications (token_hash, customer_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
    .bind(await hashLinkToken(token), customerId, now.toISOString(), new Date(now.getTime() + LINK_TTL_MS).toISOString())
    .run();
  return `${site}/verify-email?t=${encodeURIComponent(token)}`;
}

// Confirms the email for a still-valid link and retires the account's other
// open links. Returns the customer id, or null if the link isn't valid.
export async function confirmEmail(db: D1Like, token: string): Promise<string | null> {
  if (!token || token.length > 100) return null;
  const row = await db
    .prepare(`SELECT customer_id FROM email_verifications WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`)
    .bind(await hashLinkToken(token), new Date().toISOString())
    .first<{ customer_id: string }>();
  if (!row) return null;
  await db
    .prepare(`UPDATE email_verifications SET used_at = ? WHERE customer_id = ? AND used_at IS NULL`)
    .bind(new Date().toISOString(), row.customer_id)
    .run();
  await markEmailVerified(db, row.customer_id);
  return row.customer_id;
}
