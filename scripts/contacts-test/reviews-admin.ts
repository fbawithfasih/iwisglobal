// Checks the pictures on the admin Reviews page (src/lib/reviewsAdmin.ts).
import assert from 'node:assert/strict';
import { ratingCounts, averageOf, reviewSummary, daysSinceTrip, tripAgeLabel, askMix, barWidth, ASK_OVERDUE_DAYS } from '../../src/lib/reviewsAdmin';

const R = (rating: number, status: string, createdAt = '2026-10-20T00:00:00Z') => ({ rating, status, createdAt });
const reviews = [R(5, 'approved'), R(5, 'approved'), R(4, 'approved'), R(1, 'approved'), R(2, 'pending', '2026-10-10T00:00:00Z'), R(3, 'pending', '2026-10-25T00:00:00Z'), R(5, 'hidden'), R(9, 'approved'), R(0, 'approved')];
assert.deepEqual(ratingCounts(reviews), [1, 0, 0, 1, 2], 'approved only, and 9 or 0 stars are ignored');
assert.deepEqual(ratingCounts(reviews, 'pending'), [0, 1, 1, 0, 0]);
assert.deepEqual(ratingCounts([]), [0, 0, 0, 0, 0]);

assert.equal(averageOf([5, 5, 4, 1]), 3.8);
assert.equal(averageOf([5, 4]), 4.5);
assert.equal(averageOf([]), null);
assert.equal(averageOf([9, 0]), null, 'out-of-range ratings are not averaged');

const NOW = Date.parse('2026-10-28T12:00:00Z');
const sum = reviewSummary(reviews, NOW);
assert.equal(sum.total, 9); assert.equal(sum.pending, 2); assert.equal(sum.approved, 6); assert.equal(sum.hidden, 1);
assert.equal(sum.average, 3.8, 'the average is of approved reviews only, and ignores bad ratings');
assert.equal(sum.oldestPendingDays, 18);
assert.deepEqual(reviewSummary([], NOW), { total: 0, pending: 0, approved: 0, hidden: 0, average: null, oldestPendingDays: null });
assert.equal(reviewSummary([R(5, 'pending', 'nonsense')], NOW).oldestPendingDays, null, 'a bad date is not an age');

assert.equal(daysSinceTrip('2026-10-27', '2026-10-28'), 1);
assert.equal(daysSinceTrip('2026-10-28', '2026-10-28'), 0);
assert.equal(daysSinceTrip('2026-11-05', '2026-10-28'), 0, 'a trip in the future is today');
assert.equal(daysSinceTrip('x', '2026-10-28'), 0);
assert.deepEqual([tripAgeLabel(0), tripAgeLabel(1), tripAgeLabel(9)], ['Trip was today', 'Trip was yesterday', 'Trip was 9 days ago']);

assert.deepEqual(askMix([{ travelDate: '2026-10-27' }, { travelDate: '2026-10-14' }, { travelDate: '2026-10-01' }], '2026-10-28'), { total: 3, overdue: 1, oldestDays: 27 });
assert.equal(ASK_OVERDUE_DAYS, 14);
assert.deepEqual(askMix([{ travelDate: '2026-10-14' }], '2026-10-28'), { total: 1, overdue: 0, oldestDays: 14 }, 'exactly two weeks is not yet overdue');
assert.deepEqual(askMix([], '2026-10-28'), { total: 0, overdue: 0, oldestDays: null });

assert.equal(barWidth(0, 5), 0); assert.equal(barWidth(1, 100), 4); assert.equal(barWidth(5, 5), 100); assert.equal(barWidth(2, 0), 0);
console.log('reviews admin tests ok');
