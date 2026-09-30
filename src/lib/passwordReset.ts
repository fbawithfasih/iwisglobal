// "Forgot password" for email/password accounts (schema_password_resets.sql).
// The emailed link carries a random token; only its SHA-256 hash is stored.
// A link lasts an hour and works once. Asking for a link says the same thing
// whether or not the email has an account, so the form can't be used to find
// out who has one.
import type { D1Like } from './db';
import { getCustomerByEmail, getCustomerById } from './customers';
import { hashPassword, generateSaltHex } from './passwordHash';

const LINK_TTL_MS = 60 * 60 * 1000;
const MAX_LINKS_PER_HOUR = 3;
export const MIN_PASSWORD_LENGTH = 8; // same rule as /signup

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// A new link for this email, or null when there's no email/password account
// for it or it has asked for too many in the last hour (the caller shows the
// same message either way).
export async function createPasswordResetLink(
  db: D1Like,
  email: string,
  site: string
): Promise<{ to: string; name: string; link: string } | null> {
  const customer = await getCustomerByEmail(db, email);
  if (!customer || customer.provider !== 'email') return null;

  const hourAgo = new Date(Date.now() - LINK_TTL_MS).toISOString();
  const recent = await db
    .prepare(`SELECT COUNT(*) AS n FROM password_resets WHERE customer_id = ? AND created_at > ?`)
    .bind(customer.id, hourAgo)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= MAX_LINKS_PER_HOUR) return null;

  const token = newToken();
  const now = new Date();
  await db
    .prepare(`INSERT INTO password_resets (token_hash, customer_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
    .bind(await sha256Hex(token), customer.id, now.toISOString(), new Date(now.getTime() + LINK_TTL_MS).toISOString())
    .run();
  return { to: customer.email, name: customer.name, link: `${site}/reset-password?t=${encodeURIComponent(token)}` };
}

// The account a still-valid link belongs to, or null.
export async function customerForResetToken(db: D1Like, token: string): Promise<{ id: string; email: string } | null> {
  if (!token || token.length > 100) return null;
  const row = await db
    .prepare(`SELECT customer_id FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`)
    .bind(await sha256Hex(token), new Date().toISOString())
    .first<{ customer_id: string }>();
  const customer = row ? await getCustomerById(db, row.customer_id) : null;
  return customer && customer.provider === 'email' ? { id: customer.id, email: customer.email } : null;
}

// Sets the new password and retires every open link for the account. Returns
// the customer id, or null if the link is no longer valid.
export async function resetPassword(db: D1Like, token: string, newPassword: string): Promise<string | null> {
  const customer = await customerForResetToken(db, token);
  if (!customer) return null;
  const salt = generateSaltHex();
  const hash = await hashPassword(newPassword, salt);
  const now = new Date().toISOString();
  await db.prepare(`UPDATE customers SET password_hash = ?, password_salt = ? WHERE id = ?`).bind(hash, salt, customer.id).run();
  await db.prepare(`UPDATE password_resets SET used_at = ? WHERE customer_id = ? AND used_at IS NULL`).bind(now, customer.id).run();
  return customer.id;
}
