// The driver (first contact at pickup) is saved with the itinerary: schema_booking_driver.sql.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { getBookingById, updateBookingItinerary } from '../../src/lib/crm';

const raw = new DatabaseSync(':memory:');
const load = (f: string) => { for (const stmt of readFileSync(`${process.env.ROOT}/${f}`, 'utf8').replace(/^\s*--.*$/gm, '').split(';')) if (stmt.trim()) raw.exec(stmt.trim()); };
load('schema.sql');
load('schema_crm.sql');
load('schema_deposit_payments.sql');
raw.prepare(`INSERT INTO bookings (id, payment_id, order_id, tour_id, travel_date, travelers, add_on_ids, traveler_name, traveler_email, traveler_phone, amount_paid, currency, status, source, created_at, total_amount, payment_type)
  VALUES ('bk1', 'pay1', 'ord1', 'taj', '2026-11-01', 2, '', 'Guest', 'g@example.com', '+49 1609 5254544', 1000, 'INR', 'confirmed', 'website', '2026-10-01T00:00:00Z', 1000, 'full')`).run();
load('schema_booking_driver.sql');
const db: any = {
  prepare: (q: string) => ({ bind: (...v: unknown[]) => ({
    run: async () => ({ meta: { changes: Number(raw.prepare(q).run(...(v as any)).changes) } }),
    first: async () => (raw.prepare(q).get(...(v as any)) as any) ?? null,
    all: async () => ({ results: raw.prepare(q).all(...(v as any)) as any[] }),
  }) }),
};

const before = await getBookingById(db, 'bk1');
assert.equal(before?.driver_name, '', 'a booking made before the columns existed has no driver');
assert.equal(before?.driver_phone, '');

await updateBookingItinerary(db, 'bk1', { pickupTime: '7:30 AM', guideAssigned: '', vehicle: 'Innova CRYSTA', driverName: '  Sanjeev Kumar ', driverPhone: ' +91 98710 33440 ' });
const after = await getBookingById(db, 'bk1');
assert.equal(after?.driver_name, 'Sanjeev Kumar', 'name is trimmed');
assert.equal(after?.driver_phone, '+91 98710 33440', 'phone is trimmed and kept as typed');
assert.equal(after?.pickup_time, '7:30 AM');
assert.equal(after?.vehicle, 'Innova CRYSTA');

await updateBookingItinerary(db, 'bk1', { pickupTime: '7:30 AM', guideAssigned: '', vehicle: '', driverName: 'x'.repeat(200), driverPhone: '9'.repeat(100) });
const capped = await getBookingById(db, 'bk1');
assert.equal(capped?.driver_name.length, 80, 'name is capped');
assert.equal(capped?.driver_phone.length, 40, 'phone is capped');

await updateBookingItinerary(db, 'bk1', { pickupTime: '', guideAssigned: '', vehicle: '', driverName: '', driverPhone: '' });
const cleared = await getBookingById(db, 'bk1');
assert.equal(cleared?.driver_name, '');
assert.equal(cleared?.driver_phone, '', 'clearing the fields clears the driver');
console.log('booking driver tests ok');
