// Checks the pictures on the admin Private offers page (src/lib/privateOffersAdmin.ts).
import assert from 'node:assert/strict';
import { offerStage, ageDays, ageLabel, receiptProblems, paidPercent, offerMix } from '../../src/lib/privateOffersAdmin';

assert.equal(offerStage('unpaid', false), 'waiting');
assert.equal(offerStage('unpaid', true), 'closed');
assert.equal(offerStage('deposit_paid', false), 'deposit');
assert.equal(offerStage('deposit_paid', true), 'deposit', 'a closed offer with a payment still shows what was paid');
assert.equal(offerStage('paid_in_full', true), 'paid');

const NOW = Date.parse('2026-10-28T12:00:00Z');
assert.equal(ageDays('2026-10-28T01:00:00Z', NOW), 0);
assert.equal(ageDays('2026-10-27T11:00:00Z', NOW), 1);
assert.equal(ageDays('2026-10-19T12:00:00Z', NOW), 9);
assert.equal(ageDays('2026-11-05T00:00:00Z', NOW), 0, 'a future date is today');
assert.equal(ageDays('nonsense', NOW), 0);
assert.deepEqual([ageLabel(0), ageLabel(1), ageLabel(9)], ['Created today', 'Created yesterday', 'Created 9 days ago']);

assert.equal(receiptProblems([]), 0);
assert.equal(receiptProblems([
  { status: 'paid', receiptSentAt: '2026-10-20T10:00:00Z' },
  { status: 'paid', receiptSentAt: '' },
  { status: 'paid', receiptSentAt: 'pending:2026-10-20T10:00:00Z' },
  { status: 'created', receiptSentAt: '' },
]), 2, 'only paid rows count; an unpaid attempt has no receipt to send');

assert.equal(paidPercent(0, 100000), 0);
assert.equal(paidPercent(40000, 100000), 40);
assert.equal(paidPercent(100000, 100000), 100);
assert.equal(paidPercent(150000, 100000), 100, 'over-paid is capped');
assert.equal(paidPercent(500, undefined), 0);
assert.equal(paidPercent(500, 0), 0);

const mix = offerMix([
  { stage: 'waiting', ageDays: 2, receiptProblems: 0 },
  { stage: 'waiting', ageDays: 7, receiptProblems: 0 },
  { stage: 'waiting', ageDays: 30, receiptProblems: 0 },
  { stage: 'deposit', ageDays: 10, receiptProblems: 1 },
  { stage: 'paid', ageDays: 20, receiptProblems: 2 },
  { stage: 'closed', ageDays: 90, receiptProblems: 0 },
  { stage: 'unreadable', ageDays: 0, receiptProblems: 0 },
]);
assert.deepEqual(mix, { total: 7, waiting: 3, waitingLong: 2, deposit: 1, paid: 1, closed: 1, unreadable: 1, receipts: 2, needYou: 3 });
assert.deepEqual(offerMix([]), { total: 0, waiting: 0, waitingLong: 0, deposit: 0, paid: 0, closed: 0, unreadable: 0, receipts: 0, needYou: 0 });
console.log('private offers admin tests ok');
