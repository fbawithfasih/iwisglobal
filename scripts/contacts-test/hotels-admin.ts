// Checks the pictures on the admin Hotels page (src/lib/hotelsAdmin.ts): the setup checklist, content freshness and the booking mix.
import assert from 'node:assert/strict';
import { setupChecklist, refreshFreshness, bookingMix } from '../../src/lib/hotelsAdmin';

const ready = { enabled: false, markupPercent: 12, fxEurInr: 95, fxEurUsd: 1.1, hotelCount: 400, keysConfigured: true };
assert.deepEqual(setupChecklist(ready).map((i) => [i.key, i.done]), [['keys', true], ['content', true], ['markup', true], ['inr', true], ['usd', true], ['on', false]]);
assert.deepEqual(setupChecklist({ enabled: true, markupPercent: 0, fxEurInr: 0, fxEurUsd: 0, hotelCount: 0, keysConfigured: false }).map((i) => i.done), [false, false, false, false, false, true]);
assert.equal(setupChecklist(ready).every((i) => i.label && i.hint), true, 'every step says what it is and what to do');
assert.equal(setupChecklist({ ...ready, markupPercent: -3 })[2].done, false, 'a negative markup is not "above 0"');

const NOW = Date.parse('2026-10-28T12:00:00Z');
const ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
assert.deepEqual(refreshFreshness(null, null, NOW), { state: 'never', days: null });
assert.deepEqual(refreshFreshness('not a date', null, NOW), { state: 'never', days: null });
assert.deepEqual(refreshFreshness(ago(0), null, NOW), { state: 'fresh', days: 0 });
assert.deepEqual(refreshFreshness(ago(7), null, NOW), { state: 'fresh', days: 7 });
assert.deepEqual(refreshFreshness(ago(8), null, NOW), { state: 'soon', days: 8 });
assert.deepEqual(refreshFreshness(ago(30), null, NOW), { state: 'soon', days: 30 });
assert.deepEqual(refreshFreshness(ago(31), null, NOW), { state: 'old', days: 31 });
assert.deepEqual(refreshFreshness(ago(2), 'HTTP 401 from Hotelbeds', NOW), { state: 'error', days: 2 }, 'a recorded error wins over a recent run');
assert.deepEqual(refreshFreshness(ago(2), '   ', NOW), { state: 'fresh', days: 2 }, 'a blank error is no error');
assert.deepEqual(refreshFreshness(ago(-3), null, NOW), { state: 'fresh', days: 0 }, 'a run stamped in the future is today');

assert.deepEqual(bookingMix([{ status: 'booked', stuck: false }, { status: 'booked', stuck: false }, { status: 'cancelled', stuck: false }, { status: 'failed', stuck: false }, { status: 'paid', stuck: true }, { status: 'paid', stuck: false }, { status: 'quoted', stuck: false }]),
  { booked: 2, cancelled: 1, failed: 1, stuck: 1, waiting: 1, total: 7 });
assert.deepEqual(bookingMix([]), { booked: 0, cancelled: 0, failed: 0, stuck: 0, waiting: 0, total: 0 });
console.log('hotels admin tests ok');
