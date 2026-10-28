// Checks the pictures on the admin Customise-your-tour page (src/lib/customTripInsights.ts): fee freshness and the share of a day a stop takes.
import assert from 'node:assert/strict';
import { feeFreshness, dayShare, hoursLabel } from '../../src/lib/customTripInsights';

const TODAY = '2026-10-28';
const fee = (n: number, checkedOn: string, extra: { friday?: number | null; afterTaj?: number | null } = {}) => ({ fee: n, friday: extra.friday ?? null, afterTaj: extra.afterTaj ?? null, checkedOn });

// No fees at all: free, as the price rules treat it.
assert.deepEqual(feeFreshness({}, TODAY), { state: 'free', days: null });
assert.deepEqual(feeFreshness({ foreign: undefined }, TODAY), { state: 'free', days: null });
assert.deepEqual(feeFreshness({ foreign: fee(0, '') }, TODAY), { state: 'free', days: null }, 'a zero fee row is still free');

// Age is the oldest fee of the stop.
assert.deepEqual(feeFreshness({ foreign: fee(1300, '2026-10-28'), indian: fee(250, '2026-10-28') }, TODAY), { state: 'fresh', days: 0 });
assert.deepEqual(feeFreshness({ foreign: fee(1300, '2026-09-28') }, TODAY), { state: 'fresh', days: 30 }, '30 days is still fresh');
assert.deepEqual(feeFreshness({ foreign: fee(1300, '2026-09-27') }, TODAY), { state: 'soon', days: 31 });
assert.deepEqual(feeFreshness({ foreign: fee(1300, '2026-07-30') }, TODAY), { state: 'soon', days: 90 });
assert.deepEqual(feeFreshness({ foreign: fee(1300, '2026-07-29') }, TODAY), { state: 'old', days: 91 });
assert.deepEqual(feeFreshness({ foreign: fee(1300, '2026-10-20'), indian: fee(250, '2026-05-01') }, TODAY), { state: 'old', days: 180 }, 'one old fee makes the stop old');

// A fee that was never marked as checked is its own state, and a future date is not negative.
assert.deepEqual(feeFreshness({ foreign: fee(1300, '') }, TODAY), { state: 'never', days: null });
assert.deepEqual(feeFreshness({ foreign: fee(1300, 'not a date') }, TODAY), { state: 'never', days: null });
assert.deepEqual(feeFreshness({ foreign: fee(1300, '2026-11-05') }, TODAY), { state: 'fresh', days: 0 });
// Only a Friday or after-Taj fee still counts as a fee.
assert.equal(feeFreshness({ foreign: fee(0, '2026-01-01', { friday: 800 }) }, TODAY).state, 'old');

// The share of a day.
assert.deepEqual(dayShare({ visitMinutes: 150, travelMinutes: 20 }, 600), { minutes: 170, percent: 28, visitPercent: 25 });
assert.deepEqual(dayShare({ visitMinutes: 700, travelMinutes: 50 }, 600), { minutes: 750, percent: 125, visitPercent: 117 }, 'a stop longer than a day shows over 100');
assert.deepEqual(dayShare({ visitMinutes: 60, travelMinutes: 20 }, 0), { minutes: 80, percent: 0, visitPercent: 0 }, 'no day length set: no percentages');
assert.deepEqual([45, 60, 150, 600, 605].map(hoursLabel), ['45 min', '1 h', '2 h 30 min', '10 h', '10 h 5 min']);
console.log('custom trip insights tests ok');
