// Checks staff accounts (src/lib/staff.ts, schema_staff.sql) and the role rules (src/lib/authz.ts): invite, Google sign-in
// completion, sessions that stop working the moment someone is suspended, and which pages and actions each role may use.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  completeStaffSignIn, emailKey, getStaff, INVITE_TTL_MS, inviteStaff, listStaff, reactivateStaff, removeStaff, resolveStaffSession,
  revokeAllSessions, revokeSession, sha256Hex, suspendStaff,
} from '../../src/lib/staff';
import { actorLabel, canAccessPath, canDo, isOwnerOnlyPath, ownerPrincipal, OWNER_ONLY_PAGES, type Principal } from '../../src/lib/authz';

const raw = new DatabaseSync(':memory:');
for (const stmt of readFileSync(`${process.env.ROOT}/schema_staff.sql`, 'utf8').replace(/--.*$/gm, '').split(';')) if (stmt.trim()) raw.exec(stmt);
const db: any = {
  prepare: (q: string) => ({ bind: (...v: unknown[]) => ({
    run: async () => ({ meta: { changes: Number(raw.prepare(q).run(...(v as any)).changes) } }),
    first: async () => (raw.prepare(q).get(...(v as any)) as any) ?? null,
    all: async () => ({ results: raw.prepare(q).all(...(v as any)) as any[] }),
  }) }),
};
const meta = { ip: '203.0.113.5', userAgent: 'test' };
const google = (email: string, sub: string, over: Record<string, unknown> = {}) => ({ providerSub: sub, email, name: 'Asha K', emailVerified: true, ...over });

// ---- email keys: the same Gmail mailbox compares equal, other domains do not collapse
assert.equal(emailKey(' Asha.K+work@Gmail.com '), 'ashak@gmail.com');
assert.equal(emailKey('asha@googlemail.com'), 'asha@gmail.com');
assert.equal(emailKey('a.b@example.com'), 'a.b@example.com', 'dots only collapse for Gmail');
assert.equal(emailKey('not an email'), null);
assert.equal(emailKey('x@y'), null);

// ---- invite
const bad = await inviteStaff(db, { email: 'nope', invitedBy: 'owner' });
assert.equal(bad.ok, false);
const inv = await inviteStaff(db, { email: 'Asha.K@gmail.com', name: 'Asha', invitedBy: 'owner' });
assert.ok(inv.ok && inv.user.status === 'invited' && inv.user.role === 'team' && inv.user.email === 'asha.k@gmail.com');
const dup = await inviteStaff(db, { email: 'ashak@gmail.com', invitedBy: 'owner' });
assert.ok(dup.ok && dup.user.id === (inv as any).user.id, 're-inviting a waiting person renews the invite, never a second row');
assert.equal((await listStaff(db)).length, 1);

// ---- sign-in: who gets in
assert.deepEqual(await completeStaffSignIn(db, google('stranger@gmail.com', 'g-x'), meta), { ok: false, reason: 'not_invited' });
assert.deepEqual(await completeStaffSignIn(db, google('asha.k@gmail.com', 'g-1', { emailVerified: false }), meta), { ok: false, reason: 'unverified' });
const first = await completeStaffSignIn(db, google('ashak@gmail.com', 'g-1'), meta);
assert.ok(first.ok);
if (!first.ok) throw new Error('unreachable');
assert.equal(first.user.status, 'active');
assert.equal(first.user.google_sub, 'g-1');
assert.ok(first.token.length >= 40);
assert.deepEqual(await completeStaffSignIn(db, google('asha.k@gmail.com', 'g-OTHER'), meta), { ok: false, reason: 'account_mismatch' }, 'same address, different Google identity');

// ---- the cookie holds the token; the database holds only its hash
const stored = raw.prepare(`SELECT id FROM staff_sessions`).all() as any[];
assert.equal(stored.length, 1);
assert.notEqual(stored[0].id, first.token);
assert.equal(stored[0].id, await sha256Hex(first.token));

// ---- a session resolves to a person, and stops working the moment they are suspended or the session is revoked
const who = await resolveStaffSession(db, first.token);
assert.deepEqual(who, { source: 'staff', role: 'team', email: 'asha.k@gmail.com', name: 'Asha', staffId: first.user.id });
assert.equal(await resolveStaffSession(db, undefined), null);
assert.equal(await resolveStaffSession(db, 'x'.repeat(43)), null, 'unknown token');
assert.equal(await resolveStaffSession(db, first.token + 'x'), null, 'altered token');

const second = await completeStaffSignIn(db, google('asha.k@gmail.com', 'g-1'), meta);
assert.ok(second.ok);
await revokeSession(db, first.token);
assert.equal(await resolveStaffSession(db, first.token), null, 'signed out');
assert.ok(await resolveStaffSession(db, (second as any).token), 'other browser stays signed in');

assert.equal(await suspendStaff(db, first.user.id), true);
assert.equal(await resolveStaffSession(db, (second as any).token), null, 'suspended: every session stops at once');
assert.deepEqual(await completeStaffSignIn(db, google('asha.k@gmail.com', 'g-1'), meta), { ok: false, reason: 'suspended' });
assert.equal(await suspendStaff(db, first.user.id), false, 'already suspended');
assert.equal(await reactivateStaff(db, first.user.id), true);
assert.equal((await getStaff(db, first.user.id))!.status, 'active', 'had signed in before, so back to active');
const third = await completeStaffSignIn(db, google('asha.k@gmail.com', 'g-1'), meta);
assert.ok(third.ok);
await revokeAllSessions(db, first.user.id);
assert.equal(await resolveStaffSession(db, (third as any).token), null);

// ---- expired session
const t4 = await completeStaffSignIn(db, google('asha.k@gmail.com', 'g-1'), meta);
assert.ok(t4.ok);
raw.prepare(`UPDATE staff_sessions SET expires_at = ? WHERE id = ?`).run('2000-01-01T00:00:00.000Z', await sha256Hex((t4 as any).token));
assert.equal(await resolveStaffSession(db, (t4 as any).token), null, 'expired');

// ---- invites expire, and a never-signed-in person reactivates to invited
const inv2 = await inviteStaff(db, { email: 'ravi@example.com', invitedBy: 'owner' });
assert.ok(inv2.ok);
raw.prepare(`UPDATE staff_users SET invited_at = ? WHERE id = ?`).run(new Date(Date.now() - INVITE_TTL_MS - 1000).toISOString(), (inv2 as any).user.id);
assert.deepEqual(await completeStaffSignIn(db, google('ravi@example.com', 'g-2'), meta), { ok: false, reason: 'expired_invite' });
const renewed = await inviteStaff(db, { email: 'ravi@example.com', invitedBy: 'owner' });
assert.ok(renewed.ok);
assert.ok((await completeStaffSignIn(db, google('ravi@example.com', 'g-2'), meta)).ok, 'a renewed invite works');
const inv3 = await inviteStaff(db, { email: 'meena@example.com', invitedBy: 'owner' });
await suspendStaff(db, (inv3 as any).user.id);
await reactivateStaff(db, (inv3 as any).user.id);
assert.equal((await getStaff(db, (inv3 as any).user.id))!.status, 'invited');
assert.equal((await inviteStaff(db, { email: 'ravi@example.com', invitedBy: 'owner' })).ok, false, 'an active person cannot be re-invited');

// ---- remove
assert.equal(await removeStaff(db, (inv3 as any).user.id), true);
assert.equal(await getStaff(db, (inv3 as any).user.id), null);

// ---- the database refuses a second account for one address or one Google identity
assert.throws(() => raw.prepare(`INSERT INTO staff_users (id, email, email_key) VALUES ('a', 'x@example.com', 'ravi@example.com')`).run());
assert.throws(() => raw.prepare(`UPDATE staff_users SET google_sub = 'g-1' WHERE email_key = 'ravi@example.com'`).run());
assert.throws(() => raw.prepare(`INSERT INTO staff_users (id, email, email_key, role) VALUES ('b', 'y@example.com', 'y@example.com', 'admin')`).run(), 'only the two roles exist');

// ---- permission rules
const owner = ownerPrincipal();
const team: Principal = { source: 'staff', role: 'team', email: 'asha.k@gmail.com', name: 'Asha', staffId: 's' };
for (const p of ['/admin/team', '/admin/team/', '/admin/audit', '/admin/custom-trips', '/admin/leads/meta', '/admin/leads/backfill', '/admin/whatsapp/launch', '/admin/whatsapp/auto']) {
  assert.equal(isOwnerOnlyPath(p), true, p);
  assert.equal(canAccessPath(team, p), false, `team refused ${p}`);
  assert.equal(canAccessPath(owner, p), true);
}
// Spellings that reach the same page must be refused too.
for (const p of ['/ADMIN/TEAM', '/admin//team', '/admin/./team', '/admin/%74eam', '/admin/%2574eam', '/admin/x/../audit', '/admin\\audit']) {
  assert.equal(canAccessPath(team, p), false, `team refused ${p}`);
}
for (const p of ['/admin', '/admin/leads', '/admin/leads/ld1', '/admin/leads/import', '/admin/leads/report', '/admin/whatsapp', '/admin/whatsapp/knowledge', '/admin/bookings/b1', '/admin/tours', '/admin/offers', '/admin/campaigns', '/admin/hotels', '/admin/blog', '/admin/reviews', '/admin/api/push/subscribe', '/admin/leads/export']) {
  assert.equal(canAccessPath(team, p), true, `team may open ${p}`);
}
assert.equal(isOwnerOnlyPath('/tours'), false, 'public pages are not admin pages');
assert.equal(isOwnerOnlyPath('/administrator/team'), false);
assert.ok(OWNER_ONLY_PAGES.length >= 7);

assert.equal(canDo(team, 'person', 'erase'), false);
assert.equal(canDo(team, 'hotels', 'save'), false);
assert.equal(canDo(team, 'hotels', 'cancel_booking'), true);
assert.equal(canDo(team, 'whatsapp', 'purge'), false);
assert.equal(canDo(team, 'whatsapp', 'delete_chat'), true);
assert.equal(canDo(owner, 'person', 'erase'), true);
assert.equal(canDo(undefined, 'leads', 'note'), false, 'nobody signed in may do nothing');

assert.equal(actorLabel(team), 'asha.k@gmail.com');
assert.equal(actorLabel(owner), 'owner');
assert.equal(actorLabel(undefined), 'owner');

console.log('staff accounts and role tests ok');
