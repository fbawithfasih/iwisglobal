// Checks lead ownership in src/lib/leadsAdmin.ts: who is handling a lead, the Needs attention / Mine / Unassigned views,
// longest-waiting-first ordering with paging, taking a lead without ever stealing one, and the waiting label.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import * as A from '../../src/lib/leadsAdmin';

const raw = new DatabaseSync(':memory:');
for (const f of ['schema.sql', 'schema_crm.sql', 'schema_booking_locale.sql', 'schema_deposit_payments.sql', 'schema_whatsapp.sql', 'schema_whatsapp_media.sql', 'schema_contacts.sql']) {
  for (const stmt of readFileSync(`${process.env.ROOT}/${f}`, 'utf8').replace(/^\s*--.*$/gm, '').split(';')) if (stmt.trim()) raw.exec(stmt.trim());
}
const db: any = {
  prepare: (q: string) => ({ bind: (...v: unknown[]) => ({
    run: async () => ({ meta: { changes: Number(raw.prepare(q).run(...(v as any)).changes) } }),
    first: async () => (raw.prepare(q).get(...(v as any)) as any) ?? null,
    all: async () => ({ results: raw.prepare(q).all(...(v as any)) as any[] }),
  }) }),
};
const NOW = '2026-10-27T12:00:00.000Z';
const ago = (h: number) => new Date(Date.parse(NOW) - h * 3_600_000).toISOString();
const asha = 'asha@example.com';
const ravi = 'ravi@example.com';
let n = 0;
const lead = (o: { status?: string; created?: string; owner?: string; next?: string | null; first?: string | null }) => {
  const id = `ld${++n}`;
  raw.prepare(`INSERT INTO leads (id, name, email, phone, message, tour_interest, status, created_at, channel, owner, next_action_at, first_response_at, last_activity_at, updated_at)
               VALUES (?, ?, '', '', '', '', ?, ?, 'website', ?, ?, ?, ?, ?)`)
    .run(id, `Guest ${n}`, o.status ?? 'new', o.created ?? ago(1), o.owner ?? '', o.next ?? null, o.first ?? null, o.created ?? ago(1), o.created ?? ago(1));
  return id;
};

const newOld = lead({ created: ago(30) });                      // waiting 30 h, nobody on it
const newMid = lead({ created: ago(5) });
const newFresh = lead({ created: ago(0.2) });
const dueMine = lead({ status: 'contacted', created: ago(100), owner: asha, next: ago(2), first: ago(90) });
const dueLater = lead({ status: 'contacted', created: ago(100), owner: ravi, next: '2026-11-30T00:00:00.000Z', first: ago(90) });
const quote = lead({ status: 'quote_sent', created: ago(200), owner: asha, first: ago(190) });
const booked = lead({ status: 'booked', created: ago(300), owner: asha, first: ago(290) });
const lost = lead({ status: 'lost', created: ago(300) });

const ids = async (query: Parameters<typeof A.listLeadsView>[1]) => (await A.listLeadsView(db, query, NOW)).rows.map((r) => r.id);

// ---- Needs attention: unanswered plus follow-ups due, longest-waiting first
const attention = await ids({ view: 'attention' });
assert.equal(attention.length, 4);
assert.ok(attention.includes(dueMine) && !attention.includes(dueLater) && !attention.includes(quote) && !attention.includes(booked) && !attention.includes(lost));
// oldest activity first: dueMine (created 100 h ago), then 30 h, 5 h, 0.2 h
assert.deepEqual(attention, [dueMine, newOld, newMid, newFresh]);

// paging in that order never skips or repeats
const p1 = await A.listLeadsView(db, { view: 'attention', limit: 2 }, NOW);
assert.deepEqual(p1.rows.map((r) => r.id), [dueMine, newOld]);
const p2 = await A.listLeadsView(db, { view: 'attention', limit: 2, cursor: p1.next! }, NOW);
assert.deepEqual(p2.rows.map((r) => r.id), [newMid, newFresh]);
assert.equal(p2.next, null);

// other views still newest first
const openIds = await ids({ view: 'open' });
assert.equal(openIds[0], newFresh);

// ---- Mine / Unassigned
assert.deepEqual((await ids({ view: 'mine', me: asha })).sort(), [dueMine, quote].sort());
assert.deepEqual(await ids({ view: 'mine', me: 'nobody@example.com' }), []);
assert.deepEqual(await ids({ view: 'mine' }), [], 'no signed-in identity shows nothing rather than everything');
assert.deepEqual((await ids({ view: 'unassigned' })).sort(), [newOld, newMid, newFresh].sort());
const counts = await A.viewCounts(db, NOW, asha);
assert.equal(counts.attention, 4);
assert.equal(counts.mine, 2);
assert.equal(counts.unassigned, 3);
assert.equal(counts.open, 6);

// owner is on every list row
assert.equal((await A.listLeadsView(db, { view: 'mine', me: asha }, NOW)).rows[0].owner, asha);

// ---- taking a lead: first one wins, nobody is overwritten
assert.deepEqual(await A.takeLead(db, newOld, asha), { ok: true });
assert.equal((raw.prepare(`SELECT owner FROM leads WHERE id = ?`).get(newOld) as any).owner, asha);
assert.deepEqual(await A.takeLead(db, newOld, ravi), { ok: false, heldBy: asha }, 'a second person cannot take it');
assert.deepEqual(await A.takeLead(db, newOld, asha), { ok: true }, 'taking your own lead again is harmless');
assert.equal((raw.prepare(`SELECT COUNT(*) n FROM lead_activities WHERE lead_id = ? AND kind = 'system'`).get(newOld) as any).n, 1, 'one timeline entry, not two');
assert.equal((raw.prepare(`SELECT created_by FROM lead_activities WHERE lead_id = ? AND kind = 'system'`).get(newOld) as any).created_by, asha);

// ---- assigning: valid targets only, changes are logged, the waiting clock is untouched
const before = raw.prepare(`SELECT created_at, last_activity_at, first_response_at FROM leads WHERE id = ?`).get(newMid) as any;
assert.equal(await A.assignLead(db, newMid, 'Ravi@Example.com', 'owner'), true);
assert.equal((raw.prepare(`SELECT owner FROM leads WHERE id = ?`).get(newMid) as any).owner, ravi, 'stored lowercase');
assert.deepEqual(raw.prepare(`SELECT created_at, last_activity_at, first_response_at FROM leads WHERE id = ?`).get(newMid), before);
assert.equal(await A.assignLead(db, newMid, ravi, 'owner'), false, 'no change, no log entry');
assert.equal(await A.assignLead(db, newMid, 'not an email', 'owner'), false);
assert.equal(await A.assignLead(db, newMid, 'x@y', 'owner'), false);
assert.equal(await A.assignLead(db, 'ld-missing', ravi, 'owner'), false);
assert.equal(await A.assignLead(db, newMid, 'owner', 'owner'), true, 'the owner login can hold a lead');
assert.equal(await A.assignLead(db, newMid, '', ravi), true, 'back to nobody');
const log = raw.prepare(`SELECT body, created_by FROM lead_activities WHERE lead_id = ? ORDER BY id`).all(newMid) as any[];
assert.deepEqual(log.map((l) => l.body), ['Assigned to ravi@example.com', 'Took this lead', 'Unassigned']);
assert.equal(log[2].created_by, ravi);

// ---- replying to a lead that nobody holds makes it yours; one already held stays with its holder
await A.markContacted(db, newFresh, asha);
assert.equal((raw.prepare(`SELECT owner, first_response_at FROM leads WHERE id = ?`).get(newFresh) as any).owner, asha);
assert.ok((raw.prepare(`SELECT first_response_at FROM leads WHERE id = ?`).get(newFresh) as any).first_response_at);
await A.markContacted(db, dueLater, asha);
assert.equal((raw.prepare(`SELECT owner FROM leads WHERE id = ?`).get(dueLater) as any).owner, ravi, 'not taken from Ravi');
await A.markContacted(db, quote);
assert.equal((raw.prepare(`SELECT owner FROM leads WHERE id = ?`).get(quote) as any).owner, asha, 'no identity given: owner unchanged');

// ---- notes and follow-ups carry the real person, not "admin"
await A.addNote(db, newMid, 'Called, no answer', asha);
await A.setFollowUp(db, newMid, '2026-11-02', 'Try again', asha);
const by = (raw.prepare(`SELECT DISTINCT created_by FROM lead_activities WHERE lead_id = ? AND kind IN ('note','task')`).all(newMid) as any[]).map((r) => r.created_by);
assert.deepEqual(by, [asha]);

// ---- waiting label
const now = Date.parse(NOW);
assert.equal(A.waitingLabel({ status: 'new', first_response_at: null, created_at: ago(0.1) }, now), 'waiting 6 min');
assert.equal(A.waitingLabel({ status: 'new', first_response_at: null, created_at: ago(5.5) }, now), 'waiting 5 h');
assert.equal(A.waitingLabel({ status: 'new', first_response_at: null, created_at: ago(24 * 3 + 1) }, now), 'waiting 3 days');
assert.equal(A.waitingLabel({ status: 'new', first_response_at: ago(1), created_at: ago(5) }, now), null, 'already answered');
assert.equal(A.waitingLabel({ status: 'contacted', first_response_at: null, created_at: ago(5) }, now), null);
assert.equal(A.waitingLabel({ status: 'new', first_response_at: null, created_at: new Date(now + 60_000).toISOString() }, now), 'waiting 0 min', 'a clock a little ahead never goes negative');

console.log('lead ownership tests ok');
