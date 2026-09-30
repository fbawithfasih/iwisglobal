// Per-IP rate limiting for /login's email/password form
// (schema_customer_email_auth.sql). Mirrors loginAttempts.ts (used for
// /admin/login) but against a separate table, since customer and admin
// login attempts shouldn't share lockout state or thresholds.

import type { D1Like } from './db';

interface Limits {
  max: number; // attempts allowed within the window
  windowMs: number; // attempts older than this don't count
  lockoutMs: number; // how long the key is locked once it hits max
}
const LOGIN_LIMITS: Limits = { max: 5, windowMs: 15 * 60 * 1000, lockoutMs: 15 * 60 * 1000 };
// /signup: new accounts per IP (keyed "signup:<ip>" in the same table), so a
// script can't create accounts in bulk.
const SIGNUP_LIMITS: Limits = { max: 5, windowMs: 60 * 60 * 1000, lockoutMs: 60 * 60 * 1000 };

interface AttemptRow {
  attempts: number;
  window_started_at: string;
  locked_until: string | null;
}

// Returns the remaining lockout time in ms if this IP is currently locked
// out, otherwise null.
export async function checkCustomerLoginLock(db: D1Like, ip: string): Promise<number | null> {
  const row = await db
    .prepare(`SELECT attempts, window_started_at, locked_until FROM customer_login_attempts WHERE ip = ?`)
    .bind(ip)
    .first<AttemptRow>();
  if (!row?.locked_until) return null;
  const remaining = new Date(row.locked_until).getTime() - Date.now();
  return remaining > 0 ? remaining : null;
}

export async function recordFailedCustomerLogin(db: D1Like, ip: string, limits: Limits = LOGIN_LIMITS): Promise<void> {
  const now = new Date();
  const row = await db
    .prepare(`SELECT attempts, window_started_at, locked_until FROM customer_login_attempts WHERE ip = ?`)
    .bind(ip)
    .first<AttemptRow>();

  const windowExpired = !row || now.getTime() - new Date(row.window_started_at).getTime() > limits.windowMs;
  const attempts = windowExpired ? 1 : row!.attempts + 1;
  const windowStartedAt = windowExpired ? now.toISOString() : row!.window_started_at;
  const lockedUntil = attempts >= limits.max ? new Date(now.getTime() + limits.lockoutMs).toISOString() : null;

  await db
    .prepare(
      `INSERT INTO customer_login_attempts (ip, attempts, window_started_at, locked_until)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(ip) DO UPDATE SET attempts = ?, window_started_at = ?, locked_until = ?`
    )
    .bind(ip, attempts, windowStartedAt, lockedUntil, attempts, windowStartedAt, lockedUntil)
    .run();
}

export async function clearCustomerLoginAttempts(db: D1Like, ip: string): Promise<void> {
  await db.prepare(`DELETE FROM customer_login_attempts WHERE ip = ?`).bind(ip).run();
}

// Remaining wait in ms if this IP has made too many accounts lately, else null.
export function checkSignupLimit(db: D1Like, ip: string): Promise<number | null> {
  return checkCustomerLoginLock(db, `signup:${ip}`);
}

export function recordSignup(db: D1Like, ip: string): Promise<void> {
  return recordFailedCustomerLogin(db, `signup:${ip}`, SIGNUP_LIMITS);
}
