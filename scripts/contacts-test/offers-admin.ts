// Checks the pictures on the admin Offers list (src/lib/offersAdmin.ts): timing lines, the summary counts and the usage bar.
import assert from 'node:assert/strict';
import { daysBetween, offerTiming, offerSummary, usesBar } from '../../src/lib/offersAdmin';

assert.equal(daysBetween('2026-10-28', '2026-10-28'), 0);
assert.equal(daysBetween('2026-10-28', '2026-11-04'), 7);
assert.equal(daysBetween('2026-10-28', '2026-10-27'), -1);
assert.equal(daysBetween('2026-12-30', '2027-01-02'), 3, 'across a year end');

const T = '2026-10-28';
const o = (startsOn: string | null, endsOn: string | null) => ({ startsOn, endsOn });
assert.deepEqual(offerTiming(o(null, '2026-10-28'), 'Running', T), { label: 'Last day today', urgent: true, days: 0 });
assert.deepEqual(offerTiming(o(null, '2026-10-29'), 'Running', T), { label: 'Ends tomorrow', urgent: true, days: 1 });
assert.deepEqual(offerTiming(o(null, '2026-11-04'), 'Running', T), { label: 'Ends in 7 days', urgent: true, days: 7 });
assert.deepEqual(offerTiming(o(null, '2026-11-05'), 'Running', T), { label: 'Ends in 8 days', urgent: false, days: 8 });
assert.deepEqual(offerTiming(o(null, null), 'Running', T), { label: 'No end date', urgent: false, days: null });
assert.deepEqual(offerTiming(o('2026-10-29', null), 'Scheduled', T), { label: 'Starts tomorrow', urgent: false, days: 1 });
assert.deepEqual(offerTiming(o('2026-11-10', null), 'Scheduled', T), { label: 'Starts in 13 days', urgent: false, days: 13 });
assert.deepEqual(offerTiming(o(null, '2026-10-27'), 'Ended', T), { label: 'Ended yesterday', urgent: false, days: 1 });
assert.deepEqual(offerTiming(o(null, '2026-10-01'), 'Ended', T), { label: 'Ended 27 days ago', urgent: false, days: 27 });
assert.deepEqual(offerTiming(o(null, '2026-10-29'), 'Off', T), { label: 'Switched off', urgent: false, days: null }, 'an off offer is never "ending soon"');

const rows = [
  { offer: { code: null, startsOn: null, endsOn: '2026-10-30' }, state: 'Running' as const, uses: 4 },
  { offer: { code: 'DIWALI', startsOn: null, endsOn: null }, state: 'Running' as const, uses: 0 },
  { offer: { code: null, startsOn: '2026-11-15', endsOn: null }, state: 'Scheduled' as const, uses: 0 },
  { offer: { code: 'OLD', startsOn: null, endsOn: '2026-09-01' }, state: 'Ended' as const, uses: 9 },
  { offer: { code: 'PAUSED', startsOn: null, endsOn: null }, state: 'Off' as const, uses: 1 },
];
assert.deepEqual(offerSummary(rows, T), { total: 5, running: 2, scheduled: 1, ended: 1, off: 1, endingSoon: 1, idle: 1, coupons: 3, automatic: 2, uses: 14 });
assert.deepEqual(offerSummary([], T), { total: 0, running: 0, scheduled: 0, ended: 0, off: 0, endingSoon: 0, idle: 0, coupons: 0, automatic: 0, uses: 0 });

assert.equal(usesBar(0, 9), 0);
assert.equal(usesBar(1, 100), 4, 'one use is still visible');
assert.equal(usesBar(9, 9), 100);
assert.equal(usesBar(3, 9), 33);
assert.equal(usesBar(5, 0), 0, 'no maximum, no bar');
console.log('offers admin tests ok');
