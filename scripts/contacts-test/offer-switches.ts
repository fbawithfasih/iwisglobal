// Checks the per-offer switches fullPaymentOnly and englishGuideOnly (src/lib/offerPricing.ts, src/lib/offerData.ts):
// the server refuses a booking amount or a German guide on an offer that switches them off, whatever the page sends.
import assert from 'node:assert/strict';
import { planPayment, type OfferTerms } from '../../src/lib/offerPricing';
import { readOffer } from '../../src/lib/offerData';

const base: OfferTerms = {
  currency: 'USD',
  options: [{ id: 'with', label: 'With breakfast', vehicle: 'Car', totalMinor: 29900 }, { id: 'without', label: 'Without', vehicle: 'Car', totalMinor: 27900 }],
  depositPercent: 50,
  germanGuideExtraMinor: 0,
};
const req = (mode: string, guideLanguage = 'en') => ({ mode, optionId: 'with', guideLanguage });

// No switches: everything as before.
assert.equal((planPayment(base, [], req('deposit')) as any).amountMinor, 14950);
assert.equal((planPayment(base, [], req('full', 'de')) as any).guideLanguage, 'de');

// Full payment only: a booking amount is refused, paying in full still works.
const fullOnly = { ...base, fullPaymentOnly: true };
assert.deepEqual(planPayment(fullOnly, [], req('deposit')), { ok: false, error: 'bad_mode' });
const full = planPayment(fullOnly, [], req('full')) as any;
assert.equal(full.ok, true);
assert.equal(full.amountMinor, 29900);
assert.equal(full.kind, 'full');

// English only: a German guide is refused, English works, and a full payment still works.
const enOnly = { ...base, englishGuideOnly: true };
assert.deepEqual(planPayment(enOnly, [], req('full', 'de')), { ok: false, error: 'bad_language' });
assert.deepEqual(planPayment(enOnly, [], req('deposit', 'de')), { ok: false, error: 'bad_language' });
assert.equal((planPayment(enOnly, [], req('full', 'en')) as any).ok, true);

// Both switches together, as for a guest who must pay in full with an English guide.
const both = { ...base, fullPaymentOnly: true, englishGuideOnly: true };
assert.equal((planPayment(both, [], req('deposit')) as any).error, 'bad_mode');
assert.equal((planPayment(both, [], req('full', 'de')) as any).error, 'bad_language');
assert.equal((planPayment(both, [], req('full', 'en')) as any).amountMinor, 29900);
assert.equal((planPayment(both, [], { mode: 'full', optionId: 'without', guideLanguage: 'en' }) as any).amountMinor, 27900);

// A booking amount already paid earlier can still be completed with the balance, whatever the switch says now.
const paid = [{ optionId: 'with', guideLanguage: 'en' as const, kind: 'deposit' as const, amountMinor: 14950 }];
assert.equal((planPayment(fullOnly, paid, { mode: 'balance' }) as any).amountMinor, 14950);

// The switches come from the stored offer's content and are plain booleans on its terms.
const content = (extra: Record<string, unknown>) => JSON.stringify({
  title: 't', summary: 's', dateLabel: 'd', travellers: 2, pickup: 'p', hotel: 'h', itinerary: [{ time: 't', title: 'x', text: 'y' }],
  includes: ['a'], excludes: ['b'], cancellation: 'c', contactWhatsapp: '+91 1', ...extra,
});
const db = (contentJson: string): any => ({
  prepare: () => ({ bind: () => ({
    first: async () => ({
      id: 'po_' + 'a'.repeat(32), status: 'open', customer_name: 'G', customer_email: '', customer_phone: '', currency: 'USD',
      content_json: contentJson, options_json: JSON.stringify(base.options), deposit_percent: 50, german_guide_extra_minor: 0, created_at: 'now',
    }),
  }) }),
});
const id = 'po_' + 'a'.repeat(32);
const plain = await readOffer(db(content({})), id);
assert.equal(plain?.terms.fullPaymentOnly, false);
assert.equal(plain?.terms.englishGuideOnly, false);
const flagged = await readOffer(db(content({ fullPaymentOnly: true, englishGuideOnly: true })), id);
assert.equal(flagged?.terms.fullPaymentOnly, true);
assert.equal(flagged?.terms.englishGuideOnly, true);
assert.equal(flagged?.content.fullPaymentOnly, true);
assert.equal(await readOffer(db(content({ fullPaymentOnly: 'yes' })), id), null, 'a switch that is not true or false makes the offer unreadable, never silently off');

console.log('offer switches tests ok');
