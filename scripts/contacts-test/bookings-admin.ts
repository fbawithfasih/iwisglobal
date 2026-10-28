// Checks the Bookings list views, reasons and search in src/lib/bookingsAdmin.ts.
import assert from 'node:assert/strict';
import * as B from '../../src/lib/bookingsAdmin';
import type { BookingRow } from '../../src/lib/crm';

const TODAY = '2026-10-27';
let n = 0;
const bk = (o: Partial<BookingRow>): BookingRow => ({
  id: `bk_${++n}`, payment_id: `p${n}`, order_id: `o${n}`, tour_id: 'taj', travel_date: '2026-11-20', travelers: 2, add_on_ids: '',
  traveler_name: `Guest ${n}`, traveler_email: `g${n}@example.com`, traveler_phone: '+91 98765 43210', amount_paid: 1000, currency: 'INR',
  status: 'confirmed', source: 'website', pickup_time: '', guide_assigned: '', vehicle: '', created_at: `2026-10-0${n % 9 + 1}T00:00:00Z`,
  review_requested_at: null, review_token: null, total_amount: 1000, payment_type: 'full', tickets_purchased_at: null, ticket_file_key: null,
  ticket_emailed_at: null, offer_id: null, discount_label: null, discount_amount: null, ...o,
} as BookingRow);

const awaiting = bk({ status: 'awaiting_confirmation', travel_date: '2026-12-01' });
const ticketsSoon = bk({ travel_date: '2026-10-30' });
const ticketsFar = bk({ travel_date: '2026-12-15' });
const balanceSoon = bk({ travel_date: '2026-11-05', total_amount: 3000, payment_type: 'deposit' });
const balanceFar = bk({ travel_date: '2027-01-05', total_amount: 3000, payment_type: 'deposit' });
const quiet = bk({ travel_date: '2026-11-25' });
const done = bk({ status: 'completed', travel_date: '2026-09-01' });
const gone = bk({ status: 'cancelled', travel_date: '2026-11-02', total_amount: 3000 });
const all = [awaiting, ticketsSoon, ticketsFar, balanceSoon, balanceFar, quiet, done, gone];
const needsTickets = (b: BookingRow) => b === ticketsSoon || b === ticketsFar;

assert.deepEqual(B.bookingReasons(awaiting, TODAY, false).map((r) => r.key), ['awaiting']);
assert.deepEqual(B.bookingReasons(ticketsSoon, TODAY, true).map((r) => r.key), ['tickets']);
assert.deepEqual(B.bookingReasons(ticketsFar, TODAY, true), [], 'tickets are not urgent more than 7 days out');
assert.deepEqual(B.bookingReasons(balanceSoon, TODAY, false).map((r) => r.key), ['balance']);
assert.deepEqual(B.bookingReasons(balanceFar, TODAY, false), [], 'balance is not urgent more than 14 days out');
assert.deepEqual(B.bookingReasons(gone, TODAY, false), [], 'a cancelled booking never needs you');
assert.match(B.bookingReasons(bk({ travel_date: '2026-10-20' }), TODAY, true)[0].label, /passed/);

// Needs attention: soonest trip first, only the three kinds of work.
assert.deepEqual(B.viewBookings(all, 'attention', TODAY, needsTickets).map((b) => b.id), [ticketsSoon.id, balanceSoon.id, awaiting.id]);
assert.deepEqual(B.viewBookings(all, 'upcoming', TODAY, needsTickets).map((b) => b.id), [ticketsSoon.id, balanceSoon.id, quiet.id, awaiting.id, ticketsFar.id, balanceFar.id]);
assert.deepEqual(B.viewBookings(all, 'awaiting', TODAY, needsTickets), [awaiting]);
assert.deepEqual(B.viewBookings(all, 'completed', TODAY, needsTickets), [done]);
assert.deepEqual(B.viewBookings(all, 'cancelled', TODAY, needsTickets), [gone]);
assert.equal(B.viewBookings(all, 'all', TODAY, needsTickets).length, all.length);
const counts = B.bookingCounts(all, TODAY, needsTickets);
assert.equal(counts.attention, 3);
assert.equal(counts.all, 8);

// Search: name, email, id, tour name, phone digits; empty returns everything.
const name = (id: string) => (id === 'taj' ? 'Taj Mahal sunrise' : id);
assert.equal(B.searchBookings(all, '', name).length, 8);
assert.deepEqual(B.searchBookings(all, awaiting.traveler_name.toUpperCase(), name), [awaiting]);
assert.deepEqual(B.searchBookings(all, balanceSoon.traveler_email, name), [balanceSoon]);
assert.deepEqual(B.searchBookings(all, quiet.id, name), [quiet]);
assert.equal(B.searchBookings(all, 'sunrise', name).length, 8);
assert.equal(B.searchBookings(all, '987 65-432', name).length, 8, 'phone digits match regardless of spaces and dashes');
assert.equal(B.searchBookings(all, '12', name).length, 0, 'short digit strings do not match every phone');

// The picture helpers: the next 14 days, the status mix, how near a trip is, the one-day filter.
const ol = B.outlook(all, TODAY, needsTickets);
assert.equal(ol.length, 14);
assert.equal(ol[0].day, TODAY);
assert.equal(ol[13].day, '2026-11-09');
const day = (d: string) => ol.find((x) => x.day === d)!;
assert.deepEqual([day('2026-10-30').count, day('2026-10-30').pax, day('2026-10-30').toPrepare], [1, 2, 1], 'the trip in three days needs tickets');
assert.deepEqual([day('2026-11-05').count, day('2026-11-05').toPrepare], [1, 1], 'a balance still to pay needs preparing');
assert.equal(day('2026-11-02').count, 0, 'a cancelled trip is not in the outlook');
assert.equal(ol.reduce((t, d) => t + d.count, 0), 2, 'only the two live trips inside the 14 days');
const quietDone = bk({ travel_date: '2026-10-28', pickup_time: '6 AM', guide_assigned: 'Sunny', driver_name: 'Raj' });
assert.deepEqual([B.outlook([quietDone], TODAY, () => false)[1].count, B.outlook([quietDone], TODAY, () => false)[1].toPrepare], [1, 0], 'everything settled: nothing to prepare');
assert.deepEqual(B.statusMix(all), { confirmed: 5, completed: 1, awaiting: 1, cancelled: 1, total: 8 });
assert.deepEqual(B.statusMix([bk({ status: 'pending' })]), { confirmed: 0, completed: 0, awaiting: 0, cancelled: 0, total: 1 }, 'an unknown status only counts in the total');
assert.deepEqual([B.whenLabel('2026-10-27', TODAY), B.whenLabel('2026-10-28', TODAY), B.whenLabel('2026-11-01', TODAY), B.whenLabel('2026-12-01', TODAY), B.whenLabel('2026-10-26', TODAY), B.whenLabel('2026-10-20', TODAY)],
  [{ text: 'Today', tone: 'now' }, { text: 'Tomorrow', tone: 'now' }, { text: 'In 5 days', tone: 'soon' }, { text: 'In 35 days', tone: 'later' }, { text: 'Yesterday', tone: 'past' }, { text: '7 days ago', tone: 'past' }]);
assert.deepEqual(B.onDate(all, '2026-10-30'), [ticketsSoon]);
assert.equal(B.onDate(all, 'garbage').length, 8, 'not a date: the list is left alone');
assert.equal(B.onDate(all, "2026-10-30' OR 1=1").length, 8);
console.log('bookings admin tests ok');
