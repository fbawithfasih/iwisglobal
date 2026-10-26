// Staff accounts and their sessions (schema_staff.sql). A person is invited by email, becomes active on their first
// Google sign-in with that address, and can be suspended at any time. Every admin request re-checks the session AND the
// account, so suspending someone takes effect on their next click, not when a cookie expires.
import type { D1Like } from './db';
import type { Principal, Role } from './authz';

export const STAFF_COOKIE = 'staff_session';
export const STAFF_STATE_COOKIE = 'staff_oauth_state';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export type StaffUser = {
  id: string;
  email: string;
  email_key: string;
  name: string;
  role: Role;
  status: 'invited' | 'active' | 'suspended';
  google_sub: string | null;
  invited_by: string | null;
  invited_at: string;
  last_login_at: string | null;
  created_at: string;
};

const COLUMNS = 'id, email, email_key, name, role, status, google_sub, invited_by, invited_at, last_login_at, created_at';

/** The comparison key for an address: lowercase, and for Gmail also without dots and "+tag" (Google treats them as one mailbox). */
export function emailKey(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  const m = /^([^\s@]+)@([^\s@]+\.[^\s@]+)$/.exec(email);
  if (!m || email.length > 254) return null;
  let [, local, domain] = m;
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.split('+')[0].replace(/\./g, '');
  return local ? `${local}@${domain}` : null;
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function listStaff(db: D1Like): Promise<StaffUser[]> {
  const { results } = await db.prepare(`SELECT ${COLUMNS} FROM staff_users ORDER BY created_at`).bind().all<StaffUser>();
  return results;
}

export async function getStaff(db: D1Like, id: string): Promise<StaffUser | null> {
  return (await db.prepare(`SELECT ${COLUMNS} FROM staff_users WHERE id = ?`).bind(id).first<StaffUser>()) ?? null;
}

export type InviteResult = { ok: true; user: StaffUser } | { ok: false; error: string };

/** Invites a person by email. Re-inviting someone still waiting renews the invite; an active or suspended person is left alone. */
export async function inviteStaff(db: D1Like, input: { email: string; name?: string; role?: Role; invitedBy: string }): Promise<InviteResult> {
  const key = emailKey(input.email);
  if (!key) return { ok: false, error: 'That does not look like an email address.' };
  const existing = await db.prepare(`SELECT ${COLUMNS} FROM staff_users WHERE email_key = ?`).bind(key).first<StaffUser>();
  if (existing) {
    if (existing.status !== 'invited') return { ok: false, error: existing.status === 'suspended' ? 'That person is suspended. Reactivate them instead.' : 'That person already has an account.' };
    await db.prepare(`UPDATE staff_users SET invited_at = ?, name = COALESCE(NULLIF(?, ''), name), role = ? WHERE id = ?`)
      .bind(new Date().toISOString(), (input.name ?? '').trim().slice(0, 100), input.role ?? existing.role, existing.id).run();
    return { ok: true, user: (await getStaff(db, existing.id))! };
  }
  const id = `stf_${crypto.randomUUID()}`;
  await db.prepare(`INSERT INTO staff_users (id, email, email_key, name, role, status, invited_by, invited_at) VALUES (?, ?, ?, ?, ?, 'invited', ?, ?)`)
    .bind(id, input.email.trim().toLowerCase(), key, (input.name ?? '').trim().slice(0, 100), input.role === 'owner' ? 'owner' : 'team', input.invitedBy, new Date().toISOString())
    .run();
  return { ok: true, user: (await getStaff(db, id))! };
}

export type GoogleProfile = { providerSub: string; email: string; name: string; emailVerified: boolean };
export type SignInDenied = 'unverified' | 'not_invited' | 'suspended' | 'expired_invite' | 'account_mismatch';
export type SignInResult = { ok: true; user: StaffUser; token: string } | { ok: false; reason: SignInDenied };

/**
 * Finishes a Google sign-in for staff. Only an invited address that Google vouches for gets in. The first sign-in
 * activates the invite and binds the account to that Google identity; later sign-ins must be the same identity.
 */
export async function completeStaffSignIn(db: D1Like, profile: GoogleProfile, meta: { ip: string | null; userAgent: string | null }): Promise<SignInResult> {
  if (!profile.emailVerified) return { ok: false, reason: 'unverified' };
  const key = emailKey(profile.email);
  if (!key) return { ok: false, reason: 'not_invited' };
  const user = await db.prepare(`SELECT ${COLUMNS} FROM staff_users WHERE email_key = ?`).bind(key).first<StaffUser>();
  if (!user) return { ok: false, reason: 'not_invited' };
  if (user.status === 'suspended') return { ok: false, reason: 'suspended' };
  const now = new Date();
  if (user.status === 'invited') {
    if (now.getTime() - new Date(user.invited_at).getTime() > INVITE_TTL_MS) return { ok: false, reason: 'expired_invite' };
    await db.prepare(`UPDATE staff_users SET status = 'active', google_sub = ?, name = COALESCE(NULLIF(name, ''), ?) WHERE id = ? AND status = 'invited'`)
      .bind(profile.providerSub, profile.name.slice(0, 100), user.id).run();
  } else if (user.google_sub && user.google_sub !== profile.providerSub) {
    return { ok: false, reason: 'account_mismatch' };
  }
  const token = newToken();
  await db.prepare(`INSERT INTO staff_sessions (id, user_id, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?)`)
    .bind(await sha256Hex(token), user.id, new Date(now.getTime() + SESSION_TTL_MS).toISOString(), meta.ip, (meta.userAgent ?? '').slice(0, 200)).run();
  await db.prepare(`UPDATE staff_users SET last_login_at = ? WHERE id = ?`).bind(now.toISOString(), user.id).run();
  return { ok: true, user: (await getStaff(db, user.id))!, token };
}

/** The signed-in person for a session cookie, or null if the session is unknown, expired, revoked, or the account is not active. */
export async function resolveStaffSession(db: D1Like, token: string | undefined): Promise<Principal | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const row = await db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role FROM staff_sessions s JOIN staff_users u ON u.id = s.user_id
        WHERE s.id = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.status = 'active'`
    )
    .bind(await sha256Hex(token), new Date().toISOString())
    .first<{ id: string; email: string; name: string; role: Role }>();
  return row ? { source: 'staff', role: row.role, email: row.email, name: row.name || row.email, staffId: row.id } : null;
}

export async function revokeSession(db: D1Like, token: string | undefined): Promise<void> {
  if (!token) return;
  await db.prepare(`UPDATE staff_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`).bind(new Date().toISOString(), await sha256Hex(token)).run();
}

export async function revokeAllSessions(db: D1Like, userId: string): Promise<void> {
  await db.prepare(`UPDATE staff_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`).bind(new Date().toISOString(), userId).run();
}

export async function suspendStaff(db: D1Like, id: string): Promise<boolean> {
  const r = await db.prepare(`UPDATE staff_users SET status = 'suspended' WHERE id = ? AND status != 'suspended'`).bind(id).run();
  await revokeAllSessions(db, id);
  return ((r as any)?.meta?.changes ?? 0) > 0;
}

/** Back to 'active' if they had signed in before, otherwise back to 'invited'. */
export async function reactivateStaff(db: D1Like, id: string): Promise<boolean> {
  const r = await db
    .prepare(`UPDATE staff_users SET status = CASE WHEN google_sub IS NULL THEN 'invited' ELSE 'active' END, invited_at = CASE WHEN google_sub IS NULL THEN ? ELSE invited_at END WHERE id = ? AND status = 'suspended'`)
    .bind(new Date().toISOString(), id).run();
  return ((r as any)?.meta?.changes ?? 0) > 0;
}

/** Removes a person and their sessions. Their past audit entries stay (they name the email, not the account). */
export async function removeStaff(db: D1Like, id: string): Promise<boolean> {
  await db.prepare(`DELETE FROM staff_sessions WHERE user_id = ?`).bind(id).run();
  const r = await db.prepare(`DELETE FROM staff_users WHERE id = ?`).bind(id).run();
  return ((r as any)?.meta?.changes ?? 0) > 0;
}
