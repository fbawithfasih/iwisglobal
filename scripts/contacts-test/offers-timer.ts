// Checks countdown offers (offers.window_minutes): the signed timer cookie, which discount a booking gets
// before, during and after the visitor's window, the grace the server allows, and the admin form rules.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { signTimer, verifyTimer, timerCookieFrom, OFFER_TIMER_GRACE_MS } from '../../src/lib/offerTimer';
import { bestDiscount, countdownCardBadge, liveCountdownOffer, offerBadge, offerConditions, countdownLeftMs, createOffer, listLiveAutomaticOffers, resolveBookingDiscount, parseOfferForm, type Offer } from '../../src/lib/offers';

const raw = new DatabaseSync(':memory:');
for (const f of ['schema.sql', 'schema_tours.sql', 'schema_offers.sql', 'schema_offer_window.sql']) {
  for (const stmt of readFileSync(`${process.env.ROOT}/${f}`, 'utf8').replace(/--.*$/gm, '').split(';')) {
    const t = stmt.trim();
    if (!t) continue;
    try {
      raw.exec(t);
    } catch (err) {
      // schema_offers.sql also touches the tours table's price data; only the offer columns matter here.
      if (!/no such table|duplicate column/.test(String(err))) throw err;
    }
  }
}
const db: any = {
  prepare: (q: string) => ({ bind: (...v: unknown[]) => ({
    run: async () => ({ meta: { changes: Number(raw.prepare(q).run(...(v as any)).changes) } }),
    first: async () => (raw.prepare(q).get(...(v as any)) as any) ?? null,
    all: async () => ({ results: raw.prepare(q).all(...(v as any)) as any[] }),
  }) }),
};

// ---- the signed cookie
const secret = 'test-secret';
const t0 = Date.UTC(2026, 9, 26, 5, 0, 0);
const cookie = await signTimer(secret, t0);
assert.equal(await verifyTimer(secret, cookie, t0 + 1000), t0);
assert.equal(await verifyTimer('other-secret', cookie, t0 + 1000), null, 'another secret fails');
assert.equal(await verifyTimer(secret, cookie.replace(/^\d/, (d) => String((Number(d) + 1) % 10)), t0 + 1000), null, 'a changed time fails');
assert.equal(await verifyTimer(secret, `${t0}.${'0'.repeat(32)}`, t0), null, 'a made-up signature fails');
assert.equal(await verifyTimer(secret, await signTimer(secret, t0 + 10 * 60_000), t0), null, 'a start in the future fails');
assert.equal(await verifyTimer(undefined, cookie, t0), null);
assert.equal(await verifyTimer(secret, '', t0), null);
assert.equal(timerCookieFrom(`lang=de; offer_timer=${cookie}; currency=INR`), cookie);

// ---- the pure rules
const flash: Offer = {
  id: 'flash', name: 'Quick-Book Deal', code: null, kind: 'percent', percent: 20, amountInr: null, amountUsd: null,
  tourIds: ['SAME_DAY_AGRA_DELHI'], startsOn: null, endsOn: '2026-12-31', travelFrom: null, travelTo: null,
  minTravelers: null, windowMinutes: 30, active: true,
};
const ctx = { tourId: 'SAME_DAY_AGRA_DELHI', travelDate: '2026-11-10', travelers: 2, currency: 'INR' as const, today: '2026-10-26' };
assert.equal(bestDiscount(10000, { ...ctx, timerStartedAt: null, nowMs: t0 }, [flash], false), null, 'no clock, no discount');
assert.equal(bestDiscount(10000, { ...ctx, timerStartedAt: t0, nowMs: t0 + 29 * 60_000 }, [flash], false)?.amount, 2000, '20% inside the window');
assert.equal(bestDiscount(10000, { ...ctx, timerStartedAt: t0, nowMs: t0 + 31 * 60_000 }, [flash], false), null, 'gone after 30 minutes');
assert.equal(
  bestDiscount(10000, { ...ctx, timerStartedAt: t0, nowMs: t0 + 31 * 60_000, timerGraceMs: OFFER_TIMER_GRACE_MS }, [flash], false)?.amount,
  2000,
  'the server allows a Pay click in the last moments'
);
assert.equal(bestDiscount(10000, { ...ctx, timerStartedAt: t0, nowMs: t0 + 33 * 60_000, timerGraceMs: OFFER_TIMER_GRACE_MS }, [flash], false), null);
assert.equal(bestDiscount(10000, { ...ctx, tourId: 'TAJ_MAHAL_LUXURY_CAR_TOUR', timerStartedAt: t0, nowMs: t0 }, [flash], false), null, 'not on an excluded tour');
assert.equal(countdownLeftMs(flash, t0, t0 + 60_000), 29 * 60_000);
assert.equal(countdownLeftMs(flash, null, t0), null);
assert.equal(offerBadge([flash], 'SAME_DAY_AGRA_DELHI', 'INR'), null, 'tour cards never show a countdown offer');
assert.match(offerConditions(flash), /book within 30 minutes/);
// Home page and tour cards: the deal is flagged on the tours it covers, never on an excluded one.
assert.equal(countdownCardBadge([flash], 'SAME_DAY_AGRA_DELHI', 'INR'), '20% off · book within 30 min');
assert.equal(countdownCardBadge([flash], 'TAJ_MAHAL_LUXURY_CAR_TOUR', 'INR'), null);
assert.equal(liveCountdownOffer([{ ...flash, windowMinutes: null }]), null, 'an ordinary offer is not a countdown deal');
assert.equal(liveCountdownOffer([flash])?.id, 'flash');
// A bigger ordinary coupon still wins (one discount per booking).
const big: Offer = { ...flash, id: 'big', code: 'BIG25', percent: 25, windowMinutes: null };
assert.equal(bestDiscount(10000, { ...ctx, timerStartedAt: t0, nowMs: t0 }, [flash, big], false)?.offerId, 'big');

// ---- stored, listed and charged through the same server path as create-order
const id = await createOffer(db, { ...flash, code: null, amountInr: null, amountUsd: null, startsOn: '2026-10-26' });
const live = await listLiveAutomaticOffers(db, '2026-10-26');
assert.equal(live.find((o) => o.id === id)?.windowMinutes, 30);
const charged = await resolveBookingDiscount(db, { ...ctx, timerStartedAt: t0, nowMs: t0 + 5 * 60_000, timerGraceMs: OFFER_TIMER_GRACE_MS }, 10000, false);
assert.equal(charged?.amount, 2000);
assert.equal(await resolveBookingDiscount(db, { ...ctx, timerStartedAt: null, nowMs: t0 }, 10000, false), null);

// ---- the admin form
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ name: 'Quick-Book Deal', kind: 'percent', percent: '20', active: 'on', ...fields })) f.set(k, v);
  return f;
};
assert.equal(parseOfferForm(form({ windowMinutes: '30' })).input.windowMinutes, 30);
assert.equal(parseOfferForm(form({ windowMinutes: '30' })).error, undefined);
assert.equal(parseOfferForm(form({})).input.windowMinutes, null);
assert.match(parseOfferForm(form({ windowMinutes: '2' })).error ?? '', /5 to 1,440/);
assert.match(parseOfferForm(form({ windowMinutes: '30', code: 'FLASH20' })).error ?? '', /leave the code empty/);

console.log('offer countdown tests ok');
