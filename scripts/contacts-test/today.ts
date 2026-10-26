// Checks the admin Today board (src/lib/todayBoard.ts): which trips, chats, leads and follow-ups it counts, and for whom.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { addDays, loadToday } from '../../src/lib/todayBoard';

const raw = new DatabaseSync(':memory:');
for (const f of ['schema.sql', 'schema_crm.sql', 'schema_booking_locale.sql', 'schema_deposit_payments.sql', 'schema_contacts.sql', 'schema_whatsapp.sql', 'schema_whatsapp_inbox.sql', 'schema_whatsapp_media.sql', 'schema_whatsapp_handler.sql']) {
  for (const stmt of readFileSync(`${process.env.ROOT}/${f}`, 'utf8').replace(/^\s*--.*$/gm, '').split(';')) if (stmt.trim()) raw.exec(stmt.trim());
}
const db: any = {
  prepare: (q: string) => ({ bind: (...v: unknown[]) => ({
    run: async () => ({ meta: { changes: Number(raw.prepare(q).run(...(v as any)).changes) } }),
    first: async () => (raw.prepare(q).get(...(v as any)) as any) ?? null,
    all: async () => ({ results: raw.prepare(q).all(...(v as any)) as any[] }),
  }) }),
};
const NOW = new Date('2026-10-27T12:00:00.000Z');
const TODAY = '2026-10-27';
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const asha = 'asha@example.com';
const ravi = 'ravi@example.com';

assert.equal(addDays('2026-10-31', 1), '2026-11-01');
assert.equal(addDays('2026-12-31', 1), '2027-01-01');

let n = 0;
const booking = (o: { date: string; status?: string; pickup?: string }) => {
  const id = `bk${++n}`;
  raw.prepare(`INSERT INTO bookings (id, payment_id, order_id, tour_id, travel_date, travelers, traveler_name, traveler_email, traveler_phone, amount_paid, currency, created_at, status, pickup_time, total_amount)
               VALUES (?, ?, ?, 'taj', ?, 2, ?, 'a@b.c', '+911', 1000, 'INR', ?, ?, ?, 1000)`).run(id, `p${n}`, `o${n}`, o.date, `Guest ${n}`, ago(48), o.status ?? 'confirmed', o.pickup ?? '');
  return id;
};
const t2 = booking({ date: TODAY, pickup: '07:00' });
const t1 = booking({ date: TODAY, pickup: '05:30' });
const tom = booking({ date: '2026-10-28' });
booking({ date: '2026-10-29' });                       // day after tomorrow: not shown
booking({ date: TODAY, status: 'cancelled' });          // cancelled: not shown
booking({ date: '2026-10-26' });                        // yesterday: not shown
booking({ date: '2026-11-10', status: 'awaiting_confirmation' });
booking({ date: '2026-11-11', status: 'awaiting_confirmation' });

let l = 0;
const lead = (o: { status?: string; owner?: string; next?: string | null; created?: number; channel?: string }) => {
  const id = `ld${++l}`;
  raw.prepare(`INSERT INTO leads (id, name, email, phone, message, tour_interest, status, created_at, channel, owner, next_action_at, last_activity_at, updated_at)
               VALUES (?, ?, '', '', '', '', ?, ?, ?, ?, ?, ?, ?)`).run(id, `Lead ${l}`, o.status ?? 'new', ago(o.created ?? 1), o.channel ?? 'website', o.owner ?? '', o.next ?? null, ago(o.created ?? 1), ago(o.created ?? 1));
  return id;
};
const newOld = lead({ created: 30 });
const newMid = lead({ created: 5 });
lead({ created: 0.5 });
lead({ status: 'lost', created: 400 });
const dueAsha1 = lead({ status: 'contacted', owner: asha, next: ago(50), created: 100 });
const dueAsha2 = lead({ status: 'contacted', owner: asha, next: ago(2), created: 100 });
lead({ status: 'contacted', owner: asha, next: '2026-12-01T00:00:00.000Z', created: 100 }); // not due yet
lead({ status: 'contacted', owner: ravi, next: ago(3), created: 100 });                      // someone else's
lead({ status: 'booked', owner: asha, next: ago(3), created: 100 });                         // closed: never a follow-up

const chat = (id: string, o: { state?: string; by?: string; lastIn: number; replied?: number }) => {
  raw.prepare(`INSERT INTO wa_conversations (id, profile_name, state, last_message_at, created_at, handled_by) VALUES (?, ?, ?, ?, ?, ?)`).run(id, id, o.state ?? 'agent', ago(o.lastIn), ago(500), o.by ?? '');
  raw.prepare(`INSERT INTO wa_messages (wa_message_id, conversation_id, direction, kind, body, status, sent_at, created_at) VALUES (?, ?, 'in', 'text', 'hi', 'received', ?, ?)`).run(`in-${id}`, id, ago(o.lastIn), ago(o.lastIn));
  if (o.replied !== undefined) raw.prepare(`INSERT INTO wa_messages (wa_message_id, conversation_id, direction, kind, body, status, sent_at, created_at) VALUES (?, ?, 'out', 'text', 'ok', 'sent', ?, ?)`).run(`out-${id}`, id, ago(o.replied), ago(o.replied));
};
chat('c1', { lastIn: 3 });
chat('c2', { lastIn: 10, by: asha });
chat('c3', { lastIn: 6, replied: 5 });                  // answered: not waiting
chat('c4', { lastIn: 20, state: 'handed_off' });
chat('c5', { lastIn: 50, state: 'opted_out' });         // opted out: never counted

const b = await loadToday(db, { today: TODAY, me: asha, now: NOW });

assert.equal(b.tomorrow, '2026-10-28');
assert.deepEqual(b.trips.map((t) => t.id), [t1, t2, tom], 'confirmed trips today and tomorrow, earliest pickup first');
assert.equal(b.awaitingConfirmation, 2);

assert.equal(b.leadsUnanswered.total, 3);
assert.deepEqual(b.leadsUnanswered.top.map((x) => x.id).slice(0, 2), [newOld, newMid], 'oldest unanswered lead first');
assert.equal(b.followUpsDue, 3, 'open leads of anyone whose follow-up has come');
assert.deepEqual(b.myFollowUps.map((f) => f.id), [dueAsha1, dueAsha2], 'only my open leads, soonest due first');
assert.equal(b.myFollowUps[0].overdueDays, 2);
assert.equal(b.myLeads, 3, 'my open leads (the booked one is closed)');

assert.equal(b.chatsWaiting.total, 3, 'c1, c2 and the handed-off c4; answered and opted-out chats are not waiting');
assert.deepEqual(b.chatsWaiting.top.map((c) => c.id), ['c4', 'c2', 'c1'], 'longest wait first');
assert.equal(b.chatsHandedOff, 1);
assert.equal(b.myChats, 1);

// Someone with no work of their own sees none of "mine"; the shared counts are unchanged.
const other = await loadToday(db, { today: TODAY, me: 'nobody@example.com', now: NOW });
assert.deepEqual(other.myFollowUps, []);
assert.equal(other.myLeads, 0);
assert.equal(other.myChats, 0);
assert.equal(other.leadsUnanswered.total, 3);

// An empty database is all zeros, not an error.
const empty = new DatabaseSync(':memory:');
for (const f of ['schema.sql', 'schema_crm.sql', 'schema_booking_locale.sql', 'schema_deposit_payments.sql', 'schema_contacts.sql', 'schema_whatsapp.sql', 'schema_whatsapp_inbox.sql', 'schema_whatsapp_media.sql', 'schema_whatsapp_handler.sql']) {
  for (const stmt of readFileSync(`${process.env.ROOT}/${f}`, 'utf8').replace(/^\s*--.*$/gm, '').split(';')) if (stmt.trim()) empty.exec(stmt.trim());
}
const edb: any = { prepare: (q: string) => ({ bind: (...v: unknown[]) => ({
  run: async () => ({ meta: { changes: 0 } }), first: async () => (empty.prepare(q).get(...(v as any)) as any) ?? null, all: async () => ({ results: empty.prepare(q).all(...(v as any)) as any[] }) }) }) };
const z = await loadToday(edb, { today: TODAY, me: 'owner', now: NOW });
assert.deepEqual([z.trips.length, z.awaitingConfirmation, z.chatsWaiting.total, z.leadsUnanswered.total, z.followUpsDue, z.myFollowUps.length], [0, 0, 0, 0, 0, 0]);
assert.deepEqual(z.failed, []);

// One failing section does not take the others down, and is named.
const broken: any = { prepare: (q: string) => (/FROM leads|viewCounts|l\.status/.test(q) ? { bind: () => ({ first: async () => { throw new Error('no such table'); }, all: async () => { throw new Error('no such table'); }, run: async () => { throw new Error('no such table'); } }) } : db.prepare(q)) };
const partial = await loadToday(broken, { today: TODAY, me: asha, now: NOW });
assert.deepEqual(partial.failed, ['leads']);
assert.equal(partial.trips.length, 3, 'trips still load');
assert.equal(partial.chatsWaiting.total, 3, 'chats still load');
assert.equal(partial.leadsUnanswered.total, 0);
assert.deepEqual(b.failed, []);
console.log('today board tests ok');
