// Checks the pictures on the admin Tours list (src/lib/toursAdmin.ts): sales and ratings per tour, and how complete a listing is.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { loadTourStats, listingHealth, ratingLabel, SALES_DAYS } from '../../src/lib/toursAdmin';

const raw = new DatabaseSync(':memory:');
for (const f of ['schema.sql', 'schema_crm.sql', 'schema_booking_locale.sql', 'schema_deposit_payments.sql', 'schema_contacts.sql', 'schema_whatsapp.sql', 'schema_whatsapp_inbox.sql', 'schema_whatsapp_media.sql', 'schema_whatsapp_handler.sql', 'schema_tour_reviews.sql']) {
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
const ago = (days: number) => new Date(Date.parse(NOW) - days * 86_400_000).toISOString();
let n = 0;
const booking = (tour: string, o: { days: number; pax?: number; status?: string }) => {
  n++;
  raw.prepare(`INSERT INTO bookings (id, payment_id, order_id, tour_id, travel_date, travelers, traveler_name, traveler_email, traveler_phone, amount_paid, currency, created_at, status, total_amount)
               VALUES (?, ?, ?, ?, '2026-12-01', ?, 'G', 'a@b.c', '+911', 1000, 'INR', ?, ?, 1000)`).run(`b${n}`, `p${n}`, `o${n}`, tour, o.pax ?? 2, ago(o.days), o.status ?? 'confirmed');
};
const review = (tour: string, rating: number, status = 'approved') => {
  n++;
  raw.prepare(`INSERT INTO tour_reviews (id, booking_id, tour_id, rating, comment, display_name, travel_date, status, created_at, updated_at) VALUES (?, ?, ?, ?, '', 'X', '2026-10-01', ?, ?, ?)`).run(`r${n}`, `rb${n}`, tour, rating, status, ago(5), ago(5));
};
booking('taj', { days: 3, pax: 2 });
booking('taj', { days: 40, pax: 4 });
booking('taj', { days: 89, pax: 1, status: 'completed' });
booking('taj', { days: 91 });                                  // outside the 90 days
booking('taj', { days: 5, status: 'cancelled' });              // cancelled: never a sale
booking('taj', { days: 6, status: 'awaiting_confirmation' });  // waiting for us still counts
booking('agra', { days: 10, pax: 3 });
review('taj', 5); review('taj', 4); review('taj', 4); review('taj', 1, 'hidden'); review('taj', 2, 'pending');
review('agra', 3);

const s = await loadTourStats(db, NOW);
assert.deepEqual([s.get('taj')!.bookings, s.get('taj')!.guests], [4, 9], 'four live bookings in 90 days: 2 + 4 + 1 + 2 guests');
assert.deepEqual([s.get('taj')!.reviews, s.get('taj')!.rating], [3, 4.3], 'only approved reviews: 5, 4, 4');
assert.deepEqual([s.get('agra')!.bookings, s.get('agra')!.guests, s.get('agra')!.reviews, s.get('agra')!.rating], [1, 3, 1, 3]);
assert.equal(s.has('nope'), false, 'a tour with nothing has no entry (the page treats that as zero)');
assert.equal(SALES_DAYS, 90);

// A review-only tour (never sold in the window) still gets its rating.
review('sunrise', 5);
assert.deepEqual([(await loadTourStats(db, NOW)).get('sunrise')!.bookings, (await loadTourStats(db, NOW)).get('sunrise')!.rating], [0, 5]);

// Listing health.
const full = { image: '/img/a.jpg', summary: 'Sunrise at the Taj', description: 'A private full-day tour of the Taj Mahal and Agra Fort with your own guide.', highlights: ['a', 'b', 'c'], itinerary: [{ time: '6:00', activity: 'x' }, { time: '9:00', activity: 'y' }], amount: 9000 };
assert.deepEqual(listingHealth(full), { done: 6, total: 6, missing: [] });
assert.deepEqual(listingHealth({ ...full, image: '  ', highlights: ['a'], amount: 0 }), { done: 3, total: 6, missing: ['Photo', 'Highlights', 'Price'] });
assert.deepEqual(listingHealth({ ...full, summary: '', description: 'short', itinerary: [{ time: '6', activity: 'x' }] }).missing, ['Short summary', 'Description', 'Itinerary']);
assert.deepEqual([ratingLabel(null), ratingLabel(4.3), ratingLabel(5)], [null, '4.3', '5.0']);
console.log('tours admin tests ok');
