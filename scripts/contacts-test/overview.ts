// Checks the owner overview (src/lib/ownerOverview.ts): month and 30-day windows in India time, money per currency,
// outstanding balances, per-person workload, failure isolation, and that the page is owner-only.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { istStartUtc, loadOwnerOverview, monthStart } from '../../src/lib/ownerOverview';
import { canAccessPath, isOwnerOnlyPath, ownerPrincipal, type Principal } from '../../src/lib/authz';

const FILES = ['schema.sql', 'schema_crm.sql', 'schema_booking_locale.sql', 'schema_deposit_payments.sql', 'schema_contacts.sql', 'schema_tour_reviews.sql', 'schema_whatsapp.sql', 'schema_whatsapp_inbox.sql', 'schema_whatsapp_media.sql', 'schema_whatsapp_handler.sql'];
function build() {
  const raw = new DatabaseSync(':memory:');
  for (const f of FILES) for (const stmt of readFileSync(`${process.env.ROOT}/${f}`, 'utf8').replace(/^\s*--.*$/gm, '').split(';')) if (stmt.trim()) raw.exec(stmt.trim());
  const make = (q: string, v: unknown[]) => ({
    run: async () => ({ meta: { changes: Number(raw.prepare(q).run(...(v as any)).changes) } }),
    first: async () => (raw.prepare(q).get(...(v as any)) as any) ?? null,
    all: async () => ({ results: raw.prepare(q).all(...(v as any)) as any[] }),
  });
  // D1 allows .first()/.all() straight on a prepared statement as well as after .bind().
  const db: any = { prepare: (q: string) => ({ ...make(q, []), bind: (...v: unknown[]) => make(q, v) }) };
  return { raw, db };
}

assert.equal(monthStart('2026-10-27'), '2026-10-01');
assert.equal(istStartUtc('2026-10-01'), '2026-09-30T18:30:00.000Z', 'India midnight is 18:30 UTC the evening before');
assert.equal(isOwnerOnlyPath('/admin/overview'), true);
assert.equal(isOwnerOnlyPath('/admin/today'), false);
const teamMember: Principal = { source: 'staff', role: 'team', email: 'asha@example.com', name: 'Asha', staffId: 's' };
assert.equal(canAccessPath(teamMember, '/admin/overview'), false, 'a Team member cannot open the owner overview');
assert.equal(canAccessPath(teamMember, '/admin/today'), true);
assert.equal(canAccessPath(ownerPrincipal(), '/admin/overview'), true);

const { raw, db } = build();
const TODAY = '2026-10-27';
const NOW = new Date('2026-10-27T12:00:00.000Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

let n = 0;
const booking = (o: { created: string; status?: string; date?: string; paid?: number; total?: number; currency?: string }) => {
  n++;
  raw.prepare(`INSERT INTO bookings (id, payment_id, order_id, tour_id, travel_date, travelers, traveler_name, traveler_email, traveler_phone, amount_paid, currency, created_at, status, total_amount)
               VALUES (?, ?, ?, 'taj', ?, 2, 'G', 'a@b.c', '+911', ?, ?, ?, ?, ?)`).run(`b${n}`, `p${n}`, `o${n}`, o.date ?? '2026-11-05', o.paid ?? 1000, o.currency ?? 'INR', o.created, o.status ?? 'confirmed', o.total ?? o.paid ?? 1000);
};
booking({ created: '2026-10-02T05:00:00Z', paid: 5000 });                                           // INR 50 paid, in month
booking({ created: '2026-10-03T05:00:00Z', paid: 2000, total: 6000 });                              // deposit: 40 outstanding
booking({ created: '2026-10-04T05:00:00Z', paid: 300, currency: 'USD' });                           // USD
booking({ created: '2026-10-05T05:00:00Z', status: 'completed', paid: 7000, date: '2026-10-06' });
booking({ created: '2026-10-06T05:00:00Z', status: 'cancelled', paid: 9999 });                      // never counted as money
booking({ created: '2026-10-07T05:00:00Z', status: 'awaiting_confirmation', paid: 8888 });          // not money yet
booking({ created: '2026-09-30T17:00:00Z', paid: 4000 });                                           // 22:30 IST on 30 Sep: last month
booking({ created: '2026-09-30T18:45:00Z', paid: 100 });                                            // 00:15 IST on 1 Oct: this month
booking({ created: '2026-10-08T05:00:00Z', paid: 1000, date: '2026-12-25' });                       // travels after the 30-day window

const lead = (o: { status?: string; created: string; owner?: string }) => {
  n++;
  raw.prepare(`INSERT INTO leads (id, name, email, phone, message, tour_interest, status, created_at, channel, owner, last_activity_at, updated_at) VALUES (?, 'L', '', '', '', '', ?, ?, 'website', ?, ?, ?)`).run(`l${n}`, o.status ?? 'new', o.created, o.owner ?? '', o.created, o.created);
};
lead({ created: daysAgo(1) });
lead({ created: daysAgo(2), status: 'contacted', owner: 'asha@example.com' });
lead({ created: daysAgo(3), status: 'contacted', owner: 'asha@example.com' });
lead({ created: daysAgo(4), status: 'booked', owner: 'asha@example.com' });
lead({ created: daysAgo(5), status: 'lost' });
lead({ created: daysAgo(60), status: 'contacted', owner: 'ravi@example.com' });                     // old but still open: workload only

const chat = (id: string, o: { created: string; by?: string; state?: string }) =>
  raw.prepare(`INSERT INTO wa_conversations (id, profile_name, state, last_message_at, created_at, handled_by) VALUES (?, ?, ?, ?, ?, ?)`).run(id, id, o.state ?? 'agent', o.created, o.created, o.by ?? '');
chat('c1', { created: daysAgo(2), by: 'asha@example.com' });
chat('c2', { created: daysAgo(3), by: 'asha@example.com' });
chat('c3', { created: daysAgo(90), by: 'ravi@example.com' });
chat('c4', { created: daysAgo(3), by: 'ravi@example.com', state: 'opted_out' });                    // opted out: not workload
chat('c5', { created: daysAgo(1) });

raw.prepare(`INSERT INTO tour_reviews (id, booking_id, tour_id, rating, comment, display_name, travel_date, status, created_at, updated_at) VALUES ('r1','b1','taj',5,'ok','A','2026-10-01','pending','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z')`).run();
raw.prepare(`INSERT INTO tour_reviews (id, booking_id, tour_id, rating, comment, display_name, travel_date, status, created_at, updated_at) VALUES ('r2','b2','taj',5,'ok','A','2026-10-01','approved','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z')`).run();

const o = await loadOwnerOverview(db, { today: TODAY, now: NOW });
assert.deepEqual(o.failed, []);
assert.deepEqual(o.bookingsThisMonth, { confirmed: 5, completed: 1, cancelled: 1, awaiting: 1 }, 'bookings made since 1 Oct India time');
assert.deepEqual(o.paidThisMonth, [{ currency: 'INR', minor: 5000 + 2000 + 7000 + 100 + 1000 }, { currency: 'USD', minor: 300 }], 'confirmed and completed only, per currency, largest first');
assert.deepEqual(o.balanceOutstanding, [{ currency: 'INR', minor: 4000 }], 'only the deposit booking still owes');
assert.equal(o.tripsNext30Days, 5, 'confirmed trips from today to 30 days ahead; completed, cancelled, awaiting and the December one are out');
assert.deepEqual(o.leads30, { created: 5, stillOpen: 3, booked: 1, lost: 1 });
assert.equal(o.leadsUnassigned, 1);
assert.equal(o.chats30, 4, 'chats started in the last 30 days, opted-out ones included');
assert.equal(o.reviewsToCheck, 1);
assert.deepEqual(o.workload, [{ holder: 'asha@example.com', leads: 2, chats: 2 }, { holder: 'ravi@example.com', leads: 1, chats: 1 }]);

// Failure isolation: a missing table leaves the other sections intact and is named.
const broken: any = { prepare: (q: string) => (/tour_reviews/.test(q) ? { bind: () => { throw new Error('no such table'); } } : db.prepare(q)) };
const p = await loadOwnerOverview(broken, { today: TODAY, now: NOW });
assert.deepEqual(p.failed, ['reviews']);
assert.equal(p.leads30.created, 5);

// Empty database: all zeros.
const e = build();
const z = await loadOwnerOverview(e.db, { today: TODAY, now: NOW });
assert.deepEqual([z.failed.length, z.paidThisMonth.length, z.balanceOutstanding.length, z.leads30.created, z.chats30, z.workload.length], [0, 0, 0, 0, 0, 0]);
console.log('owner overview tests ok');
