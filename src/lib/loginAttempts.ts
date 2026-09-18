// Per-IP rate limiting for /admin/login (schema_login_attempts.sql). Without
// this, the login form has no defense against remote password guessing
// beyond PBKDF2's hash cost, which the attacker doesn't pay for.

import type { D1Like } from './db';

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // failed attempts older than this don't count
const LOCKOUT_MS = 15 * 60 * 1000; // how long an IP is locked out once it hits MAX_ATTEMPTS

interface AttemptRow {
  attempts: number;
  window_started_at: string;
  locked_until: string | null;
}

// Returns the remaining lockout time in ms if this IP is currently locked
// out, otherwise null.
export async function checkLoginLock(db: D1Like, ip: string): Promise<number | null> {
  const row = await db
    .prepare(`SELECT attempts, window_started_at, locked_until FROM admin_login_attempts WHERE ip = ?`)
    .bind(ip)
    .first<AttemptRow>();
  if (!row?.locked_until) return null;
  const remaining = new Date(row.locked_until).getTime() - Date.now();
  return remaining > 0 ? remaining : null;
}

export async function recordFailedLogin(db: D1Like, ip: string): Promise<void> {
  const now = new Date();
  const row = await db
    .prepare(`SELECT attempts, window_started_at, locked_until FROM admin_login_attempts WHERE ip = ?`)
    .bind(ip)
    .first<AttemptRow>();

  const windowExpired = !row || now.getTime() - new Date(row.window_started_at).getTime() > WINDOW_MS;
  const attempts = windowExpired ? 1 : row!.attempts + 1;
  const windowStartedAt = windowExpired ? now.toISOString() : row!.window_started_at;
  const lockedUntil = attempts >= MAX_ATTEMPTS ? new Date(now.getTime() + LOCKOUT_MS).toISOString() : null;

  await db
    .prepare(
      `INSERT INTO admin_login_attempts (ip, attempts, window_started_at, locked_until)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(ip) DO UPDATE SET attempts = ?, window_started_at = ?, locked_until = ?`
    )
    .bind(ip, attempts, windowStartedAt, lockedUntil, attempts, windowStartedAt, lockedUntil)
    .run();
}

export async function clearLoginAttempts(db: D1Like, ip: string): Promise<void> {
  await db.prepare(`DELETE FROM admin_login_attempts WHERE ip = ?`).bind(ip).run();
}
