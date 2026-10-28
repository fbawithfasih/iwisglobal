// Checks the pictures on the admin Lead report (src/lib/leadReportView.ts).
import assert from 'node:assert/strict';
import { reportTotals, percent, funnel, topLine, withoutSpend, minutesLabel, barWidth } from '../../src/lib/leadReportView';

const L = (key: string, leads: number, quotes: number, deposits: number, bookings: number, spend: Record<string, number> = {}) => ({ key, leads, quotes, deposits, bookings, spend });
const lines = [L('website', 40, 12, 6, 4, { INR: 500000 }), L('whatsapp', 25, 10, 5, 5), L('fb_lead_ad', 10, 1, 0, 0, { INR: 100000 }), L('email', 0, 0, 0, 0)];
assert.deepEqual(reportTotals(lines), { leads: 75, quotes: 23, deposits: 11, bookings: 9 });
assert.deepEqual(reportTotals([]), { leads: 0, quotes: 0, deposits: 0, bookings: 0 });

assert.equal(percent(9, 75), 12); assert.equal(percent(1, 3), 33.3); assert.equal(percent(5, 0), 0);

assert.deepEqual(funnel({ leads: 75, quotes: 23, deposits: 11, bookings: 9 }), [
  { label: 'Leads', n: 75, ofLeads: 100, fromPrevious: null },
  { label: 'Quote sent', n: 23, ofLeads: 30.7, fromPrevious: 30.7 },
  { label: 'Deposit paid', n: 11, ofLeads: 14.7, fromPrevious: 47.8 },
  { label: 'Booked', n: 9, ofLeads: 12, fromPrevious: 81.8 },
]);
assert.deepEqual(funnel({ leads: 0, quotes: 0, deposits: 0, bookings: 0 }).map((s) => [s.n, s.ofLeads, s.fromPrevious]), [[0, 0, null], [0, 0, 0], [0, 0, 0], [0, 0, 0]], 'an empty report divides by nothing safely');

assert.deepEqual(topLine(lines), { key: 'website', leads: 40, bookings: 4 });
assert.deepEqual(topLine([L('b', 5, 0, 0, 1), L('a', 5, 0, 0, 3), L('c', 5, 0, 0, 3)]), { key: 'a', leads: 5, bookings: 3 }, 'a tie goes to more bookings, then the name');
assert.equal(topLine([L('x', 0, 0, 0, 0)]), null); assert.equal(topLine([]), null);

assert.deepEqual(withoutSpend(lines), ['whatsapp'], 'only a line with leads and no spend; email has no leads so it is not listed');
assert.deepEqual(withoutSpend([]), []);

assert.deepEqual([minutesLabel(null), minutesLabel(45), minutesLabel(89), minutesLabel(90), minutesLabel(180), minutesLabel(2880)], ['-', '45 min', '89 min', '2 h', '3 h', '2 d']);
assert.equal(barWidth(0, 5), 0); assert.equal(barWidth(1, 100), 4); assert.equal(barWidth(5, 5), 100); assert.equal(barWidth(3, 0), 0);
console.log('lead report view tests ok');
