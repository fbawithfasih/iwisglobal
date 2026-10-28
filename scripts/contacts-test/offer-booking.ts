// Checks that a paid private offer becomes one booking (src/lib/offerBooking.ts) against in-memory SQLite.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { parseOfferDate, offerTravelDate, recordOfferBooking, recordOfferBookingSafe, offerBookingId, tourLabel, PRIVATE_OFFER_TOUR_ID } from '../../src/lib/offerBooking';

// ---- the date reader
assert.equal(parseOfferDate('Monday, 16 November 2026'), '2026-11-16');
assert.equal(parseOfferDate('16 Nov 2026'), '2026-11-16');
assert.equal(parseOfferDate('Tuesday, 17 November 2026'), '2026-11-17');
assert.equal(parseOfferDate('1st March 2027'), '2027-03-01');
assert.equal(parseOfferDate('Saturday, 21 March 2027 (arrive on 20 March 2027)'), null, 'two different days: not guessed');
assert.equal(parseOfferDate('21 March 2027, again 21 March 2027'), '2027-03-21', 'the same day twice is one day');
assert.equal(parseOfferDate('31 February 2027'), null, 'not a real date');
assert.equal(parseOfferDate('sometime in November'), null);
assert.equal(parseOfferDate(''), null);
assert.equal(offerTravelDate({ dateLabel: 'whenever', travelDate: '2026-12-01' }), '2026-12-01', 'an explicit travelDate wins');
assert.equal(offerTravelDate({ dateLabel: 'Monday, 16 November 2026', travelDate: 'bad' }), '2026-11-16', 'a bad travelDate falls back to the label');
assert.equal(offerTravelDate({ dateLabel: 'whenever' }), null);
assert.equal(tourLabel(PRIVATE_OFFER_TOUR_ID), 'Private offer');
assert.equal(tourLabel('taj', 'Taj Tour'), 'Taj Tour');
assert.equal(tourLabel('unknown-id', undefined), 'unknown-id');

// ---- database
const raw = new DatabaseSync(':memory:');
for (const f of ['schema.sql', 'schema_crm.sql', 'schema_booking_locale.sql', 'schema_deposit_payments.sql', 'schema_customers.sql', 'schema_offers.sql', 'schema_private_offers.sql']) {
  for (const stmt of readFileSync(`${process.env.ROOT}/${f}`, 'utf8').replace(/^\s*--.*$/gm, '').split(';')) { const t = stmt.trim(); if (t) { try { raw.exec(t); } catch { /* an ALTER repeated by another file */ } } }
}
const db: any = { prepare: (q: string) => ({ bind: (...v: unknown[]) => ({
  run: async () => ({ meta: { changes: Number(raw.prepare(q).run(...(v as any)).changes) } }),
  first: async () => (raw.prepare(q).get(...(v as any)) as any) ?? null,
  all: async () => ({ results: raw.prepare(q).all(...(v as any)) as any[] }),
}) }) };
const bookings = () => raw.prepare(`SELECT * FROM bookings`).all() as any[];

const content = (extra: Record<string, unknown> = {}) => JSON.stringify({ title: 'Sunrise', summary: 's', dateLabel: 'Monday, 16 November 2026', travellers: 2, pickup: 'p', hotel: 'h', itinerary: [{ time: '3', title: 't', text: 'x' }], includes: ['a'], excludes: ['b'], cancellation: 'c', contactWhatsapp: '+91', ...extra });
const offer = (n: number, extra: Record<string, unknown> = {}, name = 'Jan Hendrick Petersen') =>
  raw.prepare(`INSERT INTO private_offers (id, status, customer_name, customer_email, customer_phone, currency, content_json, options_json, deposit_percent, german_guide_extra_minor, created_at) VALUES (?, 'open', ?, '', '', 'EUR', ?, ?, 40, 0, '2026-10-16T00:00:00Z')`)
    .run(`po_${n.toString(16).padStart(32, '0')}`, name, content(extra), JSON.stringify([{ id: 'hy', label: 'Toyota Innova HyCross', vehicle: 'HyCross', totalMinor: 25000 }]));
const oid = (n: number) => `po_${n.toString(16).padStart(32, '0')}`;
const pay = (offerId: string, id: string, kind: string, amount: number, status = 'paid', at = '2026-10-22T00:00:00Z') =>
  raw.prepare(`INSERT INTO offer_payments (id, offer_id, option_id, guide_language, kind, amount_minor, total_minor, currency, order_id, payment_id, status, payer_name, payer_email, payer_phone, receipt_sent_at, created_at, updated_at) VALUES (?, ?, 'hy', 'en', ?, ?, 25000, 'EUR', ?, ?, ?, 'Jan Hendrik Petersen', 'jan@example.com', '+4915100000', '', ?, ?)`)
    .run(id, offerId, kind, amount, `order_${id}`, `pay_${id}`, status, at, at);

// ---- paid in full: one booking with the guest, the day, the people and the money
offer(1);
assert.equal(await recordOfferBooking(db, oid(1)), 'none_paid', 'nothing paid, nothing booked');
assert.equal(bookings().length, 0);
pay(oid(1), 'a', 'full', 25000);
assert.equal(await recordOfferBooking(db, oid(1)), 'created');
let b = bookings();
assert.equal(b.length, 1);
assert.deepEqual({ id: b[0].id, tour: b[0].tour_id, date: b[0].travel_date, n: b[0].travelers, name: b[0].traveler_name, email: b[0].traveler_email, paid: b[0].amount_paid, total: b[0].total_amount, cur: b[0].currency, type: b[0].payment_type, status: b[0].status, source: b[0].source, pay: b[0].payment_id, vehicle: b[0].vehicle },
  { id: offerBookingId(oid(1)), tour: 'private-offer', date: '2026-11-16', n: 2, name: 'Jan Hendrik Petersen', email: 'jan@example.com', paid: 25000, total: 25000, cur: 'EUR', type: 'full', status: 'confirmed', source: 'private_offer', pay: 'pay_a', vehicle: 'Toyota Innova HyCross' });
assert.equal(await recordOfferBooking(db, oid(1)), 'updated', 'a repeat changes nothing and adds nothing');
assert.equal(bookings().length, 1);

// ---- a booking amount, then the balance: the same booking, brought up to date
offer(2, {}, 'Anna Test');
pay(oid(2), 'd', 'deposit', 10000, 'paid', '2026-10-20T00:00:00Z');
assert.equal(await recordOfferBooking(db, oid(2)), 'created');
let d = raw.prepare(`SELECT * FROM bookings WHERE id = ?`).get(offerBookingId(oid(2))) as any;
assert.equal(d.payment_type, 'deposit'); assert.equal(d.amount_paid, 10000); assert.equal(d.total_amount, 25000);
raw.prepare(`UPDATE bookings SET status = 'completed', pickup_time = '03:15' WHERE id = ?`).run(offerBookingId(oid(2)));
pay(oid(2), 'e', 'balance', 15000, 'paid', '2026-10-21T00:00:00Z');
assert.equal(await recordOfferBooking(db, oid(2)), 'updated');
d = raw.prepare(`SELECT * FROM bookings WHERE id = ?`).get(offerBookingId(oid(2))) as any;
assert.equal(d.payment_type, 'full'); assert.equal(d.amount_paid, 25000); assert.equal(d.payment_id, 'pay_d', 'still the first payment');
assert.equal(d.status, 'completed', "the owner's status is kept"); assert.equal(d.pickup_time, '03:15', "the owner's pickup time is kept");
assert.equal(bookings().length, 2, 'two offers, two bookings');

// ---- an unpaid attempt is not a booking
offer(3, {}, 'Unpaid');
pay(oid(3), 'u', 'full', 25000, 'created');
assert.equal(await recordOfferBooking(db, oid(3)), 'none_paid');

// ---- an internal test offer never becomes a booking
offer(4, { internal: true }, 'Payment test');
pay(oid(4), 't', 'full', 25000);
assert.equal(await recordOfferBooking(db, oid(4)), 'internal');

// ---- no readable day: no guess, and the owner is told
offer(5, { dateLabel: 'arrive 20 March 2027, sightseeing 21 March 2027' }, 'Group');
pay(oid(5), 'g', 'full', 25000);
assert.equal(await recordOfferBooking(db, oid(5)), 'no_date');
const sent: string[] = [];
(globalThis as any).fetch = async (_u: string, init: any) => { sent.push(String(init?.body ?? '')); return new Response('{}', { status: 200 }); };
assert.equal(await recordOfferBookingSafe({ RESEND_API_KEY: 'k', ADMIN_EMAIL: 'o@x.com', ALERT_EMAIL: 'o@x.com' }, db, oid(5)), 'no_date');
assert.equal(bookings().length, 2, 'still no booking for it');
// an explicit travelDate on the offer fixes it
offer(6, { dateLabel: 'arrive 20 March 2027, sightseeing 21 March 2027', travelDate: '2027-03-21' }, 'Group 2');
pay(oid(6), 'h', 'full', 25000);
assert.equal(await recordOfferBooking(db, oid(6)), 'created');
assert.equal((raw.prepare(`SELECT travel_date FROM bookings WHERE id = ?`).get(offerBookingId(oid(6))) as any).travel_date, '2027-03-21');

// ---- a database failure is reported, not thrown, by the safe wrapper
const broken: any = { prepare: () => { throw new Error('D1 is down'); } };
assert.equal(await recordOfferBookingSafe({}, broken, oid(1)), 'error');
console.log('offer booking tests ok');
