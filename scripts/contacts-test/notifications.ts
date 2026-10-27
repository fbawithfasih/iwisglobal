// Checks the "waiting for you" bell (src/lib/notifications.ts): what is counted, that nothing is counted twice, that the
// number falls when work is done, per-person follow-ups, and that a failing database gives a flagged zero, not an error.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { loadNotifications } from '../../src/lib/notifications';

const raw = new DatabaseSync(':memory:');
for (const f of ['schema.sql', 'schema_crm.sql', 'schema_booking_locale.sql', 'schema_deposit_payments.sql', 'schema_contacts.sql', 'schema_whatsapp.sql', 'schema_whatsapp_inbox.sql', 'schema_whatsapp_media.sql', 'schema_whatsapp_handler.sql']) {
  for (const stmt of readFileSync(`${process.env.ROOT}/${f}`, 'utf8').replace(/^\s*--.*$/gm, '').split(';')) if (stmt.trim()) raw.exec(stmt.trim());
}
const mk = (r: DatabaseSync) => ({ prepare: (q: string) => ({ bind: (...v: unknown[]) => ({
  run: async () => ({ meta: { changes: Number(r.prepare(q).run(...(v as any)).changes) } }),
  first: async () => (r.prepare(q).get(...(v as any)) as any) ?? null,
  all: async () => ({ results: r.prepare(q).all(...(v as any)) as any[] }),
}) }) }) as any;
const db = mk(raw);
const NOW = new Date('2026-10-27T12:00:00.000Z');
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const asha = 'asha@example.com';

let n = 0;
const lead = (o: { status?: string; owner?: string; next?: string | null; created?: number }) => {
  const id = `ld${++n}`;
  raw.prepare(`INSERT INTO leads (id, name, email, phone, message, tour_interest, status, created_at, channel, owner, next_action_at, last_activity_at, updated_at)
               VALUES (?, ?, '', '', '', '', ?, ?, 'website', ?, ?, ?, ?)`).run(id, `L${n}`, o.status ?? 'new', ago(o.created ?? 1), o.owner ?? '', o.next ?? null, ago(o.created ?? 1), ago(o.created ?? 1));
  return id;
};
const chat = (id: string, o: { lastIn: number; replied?: number; state?: string }) => {
  raw.prepare(`INSERT INTO wa_conversations (id, profile_name, state, last_message_at, created_at, handled_by) VALUES (?, ?, ?, ?, ?, '')`).run(id, id, o.state ?? 'agent', ago(o.lastIn), ago(500));
  raw.prepare(`INSERT INTO wa_messages (wa_message_id, conversation_id, direction, kind, body, status, sent_at, created_at) VALUES (?, ?, 'in', 'text', 'hi', 'received', ?, ?)`).run(`in-${id}`, id, ago(o.lastIn), ago(o.lastIn));
  if (o.replied !== undefined) raw.prepare(`INSERT INTO wa_messages (wa_message_id, conversation_id, direction, kind, body, status, sent_at, created_at) VALUES (?, ?, 'out', 'text', 'ok', 'sent', ?, ?)`).run(`out-${id}`, id, ago(o.replied), ago(o.replied));
};
const booking = (status: string) => {
  n++;
  raw.prepare(`INSERT INTO bookings (id, payment_id, order_id, tour_id, travel_date, travelers, traveler_name, traveler_email, traveler_phone, amount_paid, currency, created_at, status)
               VALUES (?, ?, ?, 'taj', '2026-11-05', 2, 'G', 'a@b.c', '+911', 1000, 'INR', ?, ?)`).run(`bk${n}`, `p${n}`, `o${n}`, ago(48), status);
};

// Nothing waiting: zero, no items.
let r = await loadNotifications(db, { me: asha, now: NOW });
assert.deepEqual([r.total, r.items.length, r.failed], [0, 0, false]);

chat('c1', { lastIn: 3 });                         // waiting
chat('c2', { lastIn: 9 });                         // waiting, longest
chat('c3', { lastIn: 6, replied: 5 });             // answered
chat('c4', { lastIn: 30, state: 'opted_out' });    // opted out: never counted
lead({ created: 5 });                              // new, unanswered
lead({ status: 'contacted', owner: asha, next: ago(2), created: 100 });   // follow-up due, mine
lead({ status: 'contacted', owner: 'ravi@example.com', next: ago(3), created: 100 }); // follow-up due, someone else's
lead({ status: 'contacted', owner: asha, next: '2026-12-01T00:00:00.000Z', created: 100 }); // not due
lead({ status: 'booked', owner: asha, next: ago(3), created: 100 });     // closed
booking('awaiting_confirmation');
booking('confirmed');

r = await loadNotifications(db, { me: asha, now: NOW });
const by = Object.fromEntries(r.items.map((i) => [i.key, i]));
assert.equal(by.chats.count, 2);
assert.match(by.chats.detail, /Longest wait 9 h/);
assert.equal(by.leads.count, 3, 'one new lead plus two follow-ups due (anyone\'s), each counted once');
assert.match(by.leads.detail, /1 with no reply, 2 follow-ups due/);
assert.equal(by.mine.count, 1, 'only my own open follow-up');
assert.equal(by.confirm.count, 1);
assert.equal(r.total, 2 + 3 + 1, 'total = chats + leads needing attention + bookings to confirm; "mine" is a subset of the leads number and is not added again');
assert.deepEqual(r.items.map((i) => i.key), ['chats', 'leads', 'mine', 'confirm']);
assert.ok(r.items.every((i) => i.href.startsWith('/admin')));

// Someone with no follow-ups of their own sees the shared counts but no "mine".
r = await loadNotifications(db, { me: 'nobody@example.com', now: NOW });
assert.equal(r.items.some((i) => i.key === 'mine'), false);
assert.equal(r.total, 6);

// Doing the work lowers the number (it is not an unread counter).
raw.prepare(`INSERT INTO wa_messages (wa_message_id, conversation_id, direction, kind, body, status, sent_at, created_at) VALUES ('out-c1','c1','out','text','ok','sent',?,?)`).run(NOW.toISOString(), NOW.toISOString());
raw.prepare(`UPDATE bookings SET status = 'confirmed' WHERE status = 'awaiting_confirmation'`).run();
r = await loadNotifications(db, { me: asha, now: NOW });
assert.equal(r.total, 1 + 3 + 0);

// Singular wording.
assert.match(r.items.find((i) => i.key === 'chats')!.label, /^1 WhatsApp chat waiting for a reply$/);
assert.match(r.items.find((i) => i.key === 'mine')!.label, /^1 of your follow-ups is due$/);

// A failing database gives a flagged zero, never an exception.
const broken: any = { prepare: () => ({ bind: () => ({ first: async () => { throw new Error('no such table'); }, all: async () => { throw new Error('no such table'); }, run: async () => { throw new Error('no such table'); } }) }) };
r = await loadNotifications(broken, { me: asha, now: NOW });
assert.deepEqual([r.total, r.items.length, r.failed], [0, 0, true]);
console.log('notifications tests ok');
