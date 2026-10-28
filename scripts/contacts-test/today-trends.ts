// Checks the pictures on the admin Today page (src/lib/todayTrends.ts): the week of trips, enquiries and bookings per India day,
// the comparison with the period before, how ready a trip is, and how late a wait is.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { loadTrends, summarise, readiness, urgency, TREND_DAYS } from '../../src/lib/todayTrends';

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
const TODAY = '2026-10-27';
let n = 0;
const booking = (o: { date: string; status?: string; createdAt?: string; pickup?: string }) => {
  n++;
  raw.prepare(`INSERT INTO bookings (id, payment_id, order_id, tour_id, travel_date, travelers, traveler_name, traveler_email, traveler_phone, amount_paid, currency, created_at, status, total_amount, pickup_time)
               VALUES (?, ?, ?, 'taj', ?, 2, ?, 'a@b.c', '+911', 1000, 'INR', ?, ?, 1000, ?)`).run(`bk${n}`, `p${n}`, `o${n}`, o.date, `Guest ${n}`, o.createdAt ?? '2026-08-01T06:00:00.000Z', o.status ?? 'confirmed', o.pickup ?? '');
};
const lead = (createdAt: string, status = 'new') => {
  n++;
  raw.prepare(`INSERT INTO leads (id, name, email, phone, message, tour_interest, status, created_at, channel, last_activity_at, updated_at)
               VALUES (?, 'L', '', '', '', '', ?, ?, 'website', ?, ?)`).run(`ld${n}`, status, createdAt, createdAt, createdAt);
};

// The week: today to six days ahead, confirmed only, in date and pickup order.
booking({ date: TODAY, pickup: '07:00' });
booking({ date: TODAY, pickup: '05:30' });
booking({ date: '2026-11-02' });                       // day 6: inside
booking({ date: '2026-11-03' });                       // day 7: outside
booking({ date: '2026-10-26' });                       // yesterday: outside
booking({ date: '2026-10-28', status: 'cancelled' });  // cancelled: outside
// The flow, by India day (UTC+5:30): 19:00 UTC on the 26th is already the 27th in India.
lead('2026-10-27T03:00:00.000Z');
lead('2026-10-26T19:00:00.000Z');                      // 00:30 on the 27th in India
lead('2026-10-26T18:00:00.000Z');                      // 23:30 on the 26th in India
lead('2026-10-27T04:00:00.000Z', 'spam');              // spam never counts
lead('2026-09-01T00:00:00.000Z');                      // before the window
booking({ date: '2026-12-01', createdAt: '2026-10-27T02:00:00.000Z' });
booking({ date: '2026-12-01', createdAt: '2026-10-27T03:00:00.000Z', status: 'awaiting_confirmation' });
booking({ date: '2026-12-01', createdAt: '2026-10-27T03:00:00.000Z', status: 'cancelled' });   // cancelled: not a booking

const t = await loadTrends(db, { today: TODAY });
assert.deepEqual(t.failed, []);
assert.deepEqual(t.week.map((b) => [b.travel_date, b.pickup_time]), [[TODAY, '05:30'], [TODAY, '07:00'], ['2026-11-02', '']]);
assert.equal(t.days.length, TREND_DAYS);
assert.equal(t.days[0].day, '2026-09-30', '28 days ending today');
assert.equal(t.days.at(-1)!.day, TODAY);
const day = (d: string) => t.days.find((x) => x.day === d)!;
assert.deepEqual([day(TODAY).leads, day('2026-10-26').leads], [2, 1], 'enquiries are counted on the India day, spam left out');
assert.equal(day(TODAY).bookings, 2, 'confirmed and awaiting count; cancelled does not');
assert.equal(t.days.reduce((s, d) => s + d.leads, 0), 3, 'the September lead is outside the window');

// A part that cannot load is named, and the other part still shows.
const broken: any = { prepare: (q: string) => (/FROM leads/.test(q) ? { bind: () => ({ all: async () => { throw new Error('no table'); } }) } : db.prepare(q)) };
const b = await loadTrends(broken, { today: TODAY });
assert.deepEqual(b.failed, ['flow']);
assert.equal(b.week.length, 3);
assert.equal(b.days.every((d) => d.leads === 0 && d.bookings === 0), true);

// Totals against the period before.
const s = summarise(t.days, 7);
assert.deepEqual([s.leads, s.bookings, s.prevLeads, s.prevBookings], [3, 2, 0, 0]);
const s14 = summarise(t.days, 14);
assert.equal(s14.leads, 3);

// Readiness: five checks, the missing ones named.
const ready = { pickup_time: '7:30 AM', guide_assigned: 'Sunny', driver_name: 'Sanjeev', total_amount: 1000, amount_paid: 1000 };
assert.deepEqual(readiness(ready, false), { done: 5, total: 5, missing: [] });
assert.deepEqual(readiness({ ...ready, driver_name: '', guide_assigned: '' }, true), { done: 2, total: 5, missing: ['Guide', 'Driver', 'Tickets'] });
assert.deepEqual(readiness({ ...ready, amount_paid: 400 }, false).missing, ['Balance']);

// Urgency: under an hour, under four hours, then late.
assert.deepEqual([0, 59 * 60_000, 3_600_000, 3 * 3_600_000, 4 * 3_600_000, 90 * 3_600_000].map(urgency), ['calm', 'calm', 'soon', 'soon', 'late', 'late']);
console.log('today trends tests ok');
