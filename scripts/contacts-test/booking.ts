// Checks src/lib/tourBooking.ts and the order-notes packing: a paid tour booking is recorded once whichever of the
// browser or the payment webhook arrives first, at the amount Razorpay charged, with the ad it came from.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { finalizeTourBooking } from '../../src/lib/tourBooking';
import { bookingFromOrder } from '../../src/lib/payments/razorpay';
import { packAttribution, packGuest, unpackAttribution, unpackGuest, attributionFromBody, packMeta, unpackMeta } from '../../src/lib/payments/orderNotes';
import { buildPayload, metaContextFromRequest, sendMetaEvent, NO_CONSENT } from '../../src/lib/metaCapi';

const raw = new DatabaseSync(':memory:');
for (const f of ['schema.sql', 'schema_crm.sql', 'schema_booking_locale.sql', 'schema_deposit_payments.sql', 'schema_customers.sql', 'schema_tours.sql', 'schema_offers.sql', 'schema_whatsapp.sql', 'schema_contacts.sql']) {
  for (const stmt of readFileSync(`${process.env.ROOT}/${f}`, 'utf8').replace(/--.*$/gm, '').split(';')) {
    const t = stmt.trim();
    if (t) raw.exec(t);
  }
}
const db: any = {
  prepare: (q: string) => ({ bind: (...v: unknown[]) => ({
    run: async () => ({ meta: { changes: Number(raw.prepare(q).run(...(v as any)).changes) } }),
    first: async () => (raw.prepare(q).get(...(v as any)) as any) ?? null,
    all: async () => ({ results: raw.prepare(q).all(...(v as any)) as any[] }),
  }) }),
};
const count = (t: string, where = '1=1') => (raw.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE ${where}`).get() as any).n as number;

const emails: any[] = [];
const metaCalls: { url: string; auth: string; body: any }[] = [];
const refunds: string[] = [];
(globalThis as any).fetch = async (url: string, init: any) => {
  if (url.includes('api.resend.com')) { emails.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); }
  if (url.includes('graph.facebook.com')) { metaCalls.push({ url, auth: init.headers.Authorization, body: JSON.parse(init.body) }); return new Response('{"events_received":1}', { status: 200 }); }
  if (/\/payments\/[^/]+\/refund$/.test(url)) { refunds.push(url); return new Response('{}', { status: 200 }); }
  return new Response('{}', { status: 404 });
};
const env: Record<string, any> = { RESEND_API_KEY: 're_x', RAZORPAY_KEY_ID: 'rzp_k', RAZORPAY_KEY_SECRET: 'rzp_s', ADMIN_EMAIL: 'owner@example.com' };

// ---- notes packing: always one Razorpay note (<= 255 chars), and round-trips
const g = { name: 'Élise Müller', email: 'elise@example.de', phone: '+49 151 1234567', locale: 'de' };
assert.deepEqual(unpackGuest(packGuest(g)), g);
const huge = packGuest({ name: 'x'.repeat(500), email: 'y'.repeat(500) + '@e.com', phone: '1'.repeat(80), locale: 'de' });
assert.ok(huge.length <= 255, 'guest note fits');
assert.equal(unpackGuest(huge).locale, 'de', 'still parseable after shortening');
const a = attributionFromBody({ source: 'google', medium: 'cpc', campaign: 'taj-autumn', landingPage: '/tours/taj-mahal-sunrise-tour', gclid: 'G'.repeat(300), fbclid: '' });
const packedA = packAttribution(a);
assert.ok(packedA.length <= 255, 'attribution note fits even with a long gclid');
assert.equal(unpackAttribution(packedA).campaign, 'taj-autumn');
assert.equal(unpackAttribution(packAttribution(attributionFromBody({ fbclid: 'abc' }))).fbclid, true);
assert.deepEqual(unpackGuest('not json'), { name: '', email: '', phone: '', locale: '' });

// ---- the order as Razorpay holds it: amounts come from the order, never from today's catalog
const order = (amount: number, extra: Record<string, string> = {}) => ({
  amount,
  notes: {
    tourId: 'taj-sunrise', date: '2026-12-01', travelers: '2', addOnIds: '', currency: 'USD', totalAmount: '40000', paymentType: 'deposit',
    foundingGuestDiscount: 'true', discount: '60', offerId: 'founding-guest', discountLabel: 'Founding Guest Offer (15% off)',
    guest: packGuest(g), attr: packAttribution({ source: 'facebook', medium: 'paid_social', campaign: 'autumn-taj', landingPage: '/tours/x', gclid: '', fbclid: true }),
    ...extra,
  },
});
const v1 = bookingFromOrder('pay_1', 'order_1', order(10000));
assert.equal(v1.amountCharged, 10000); assert.equal(v1.totalAmount, 40000); assert.equal(v1.paymentType, 'deposit'); assert.equal(v1.guest.email, 'elise@example.de');

// ---- the webhook gets there first (browser lost): booking, lead with the campaign, both emails
assert.equal(await finalizeTourBooking(env, db, { verified: v1 }), 'inserted');
const b = raw.prepare(`SELECT * FROM bookings WHERE payment_id = 'pay_1'`).get() as any;
assert.equal(b.id, 'bk_pay_1');
assert.equal(b.amount_paid, 10000, 'records what Razorpay charged');
assert.equal(b.total_amount, 40000);
assert.equal(b.discount_amount, 6000);
assert.equal(b.traveler_email, 'elise@example.de', 'contact details from the order when the browser sent none');
assert.equal(b.locale, 'de');
assert.equal(emails.length, 2, 'guest confirmation and owner notification');
const lead = raw.prepare(`SELECT channel, campaign, status, booking_id FROM leads WHERE booking_id = 'bk_pay_1'`).get() as any;
assert.equal(lead.campaign, 'autumn-taj', 'the ad campaign reaches the lead report');
assert.equal(lead.status, 'deposit_paid');

// ---- then the browser call arrives: nothing twice, but a signed-in guest's account link is kept
raw.exec(`INSERT INTO customers (id, email, name, provider, provider_sub, created_at) VALUES ('cus_1', 'elise@example.de', 'Elise', 'google', 'sub1', '2026-01-01')`);
assert.equal(await finalizeTourBooking(env, db, { verified: v1, travelerEmail: 'elise@example.de', customerId: 'cus_1' }), 'duplicate');
assert.equal(count('bookings', `payment_id = 'pay_1'`), 1);
assert.equal(emails.length, 2, 'no second set of emails');
assert.equal((raw.prepare(`SELECT customer_id FROM bookings WHERE payment_id = 'pay_1'`).get() as any).customer_id, 'cus_1');
// and the webhook redelivered again: still one
assert.equal(await finalizeTourBooking(env, db, { verified: v1 }), 'duplicate');

// ---- browser first with its own contact details: they win over the order's copy
const v2 = bookingFromOrder('pay_2', 'order_2', order(40000, { paymentType: 'full', travelers: '3', date: '2026-12-02' }));
assert.equal(await finalizeTourBooking(env, db, { verified: v2, travelerName: 'Elise M', travelerEmail: 'elise.new@example.de', travelerPhone: '+491511111111', locale: 'en' }), 'inserted');
const b2 = raw.prepare(`SELECT traveler_email, traveler_name, locale, amount_paid FROM bookings WHERE payment_id = 'pay_2'`).get() as any;
assert.deepEqual([b2.traveler_email, b2.traveler_name, b2.locale, b2.amount_paid], ['elise.new@example.de', 'Elise M', 'en', 40000]);

// ---- the date sold out between order and payment: full refund, no booking, no emails
// fill the date to exactly the capacity (20 travellers), then one more traveller does not fit
for (let i = 0; i < 5; i++) {
  assert.equal(await finalizeTourBooking(env, db, { verified: bookingFromOrder(`pay_f${i}`, `o_f${i}`, order(1000, { date: '2026-12-09', travelers: '4' })) }), 'inserted');
}
assert.equal(count('bookings', `travel_date = '2026-12-09'`), 5, 'a 20-traveller day fits');
const before = emails.length;
assert.equal(await finalizeTourBooking(env, db, { verified: bookingFromOrder('pay_over', 'o_over', order(1000, { date: '2026-12-09', travelers: '1' })) }), 'refunded');
assert.equal(refunds.length, 1); assert.ok(refunds[0].includes('/payments/pay_over/refund'));
assert.equal(count('bookings', `payment_id = 'pay_over'`), 0);
assert.equal(emails.length, before);

// ---- Meta Conversions API
const sha = async (v: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)))).map((b) => b.toString(16).padStart(2, '0')).join('');
const req = (cookie: string) => new Request('https://www.iwisglobal.com/api/create-order', { method: 'POST', headers: { cookie, 'user-agent': 'Mozilla/5.0 Test', 'cf-connecting-ip': '203.0.113.9' } });
assert.deepEqual(metaContextFromRequest(req('_fbp=fb.1.1.123; _fbc=fb.1.2.abc')), NO_CONSENT, 'no cookie consent: nothing is kept for Meta');
assert.deepEqual(metaContextFromRequest(req('cookie_consent=denied; _fbp=fb.1.1.123')), NO_CONSENT);
const ctx = metaContextFromRequest(req('cookie_consent=granted; _fbp=fb.1.1.123; _fbc=fb.1.2.abc'));
assert.deepEqual(ctx, { consent: true, fbp: 'fb.1.1.123', fbc: 'fb.1.2.abc', ip: '203.0.113.9', userAgent: 'Mozilla/5.0 Test' });
assert.deepEqual(unpackMeta(packMeta(ctx)), ctx, 'consent and identifiers round-trip through the order note');
assert.equal(unpackMeta(packMeta(NO_CONSENT)).consent, false);
assert.ok(packMeta({ ...ctx, fbc: 'f'.repeat(300), userAgent: 'u'.repeat(400) }).length <= 255, 'meta note fits');
assert.equal(unpackMeta(packMeta({ ...ctx, fbc: 'f'.repeat(300), userAgent: 'u'.repeat(400) })).consent, true);
const pl: any = await buildPayload({ name: 'Purchase', eventId: 'pay_x', sourceUrl: 'https://www.iwisglobal.com/booking/confirmation', email: '  Elise@Example.DE ', phone: '+49 151 1234-567', fullName: 'Élise Müller', value: 123.456, currency: 'USD', contentIds: ['taj'], numItems: 2 }, ctx, 1700000000);
assert.deepEqual(pl.user_data.em, [await sha('elise@example.de')], 'email trimmed, lower-cased, hashed');
assert.deepEqual(pl.user_data.ph, [await sha('491511234567')], 'phone as digits with country code, hashed');
assert.deepEqual(pl.user_data.fn, [await sha('élise')]); assert.deepEqual(pl.user_data.ln, [await sha('müller')]);
assert.ok(!JSON.stringify(pl).includes('Elise@') && !JSON.stringify(pl).includes('151'), 'no readable contact data is sent');
assert.equal(pl.event_id, 'pay_x'); assert.equal(pl.action_source, 'website'); assert.equal(pl.custom_data.value, 123.46);
assert.equal(pl.user_data.client_user_agent, 'Mozilla/5.0 Test'); assert.equal(pl.user_data.fbp, 'fb.1.1.123');
const capiEnv = { ...env, META_CAPI_TOKEN: 'EAAtoken', META_CAPI_TEST_CODE: 'TEST123' };
assert.equal(await sendMetaEvent(env, { name: 'Lead', eventId: 'l1', sourceUrl: 'x' }, ctx), false, 'no token: nothing sent');
assert.equal(await sendMetaEvent(capiEnv, { name: 'Lead', eventId: 'l1', sourceUrl: 'x' }, NO_CONSENT), false, 'no consent: nothing sent');
assert.equal(metaCalls.length, 0);

// a booking with consent: one Purchase, deduplicated with the browser's by the payment id
const vc = bookingFromOrder('pay_meta', 'o_meta', order(25000, { date: '2026-12-20', meta: packMeta(ctx) }));
assert.equal(await finalizeTourBooking(capiEnv, db, { verified: vc }), 'inserted');
assert.equal(metaCalls.length, 1);
assert.ok(metaCalls[0].url.endsWith('/179602460825688/events'));
assert.equal(metaCalls[0].auth, 'Bearer EAAtoken');
assert.equal(metaCalls[0].body.test_event_code, 'TEST123');
const ev = metaCalls[0].body.data[0];
assert.deepEqual([ev.event_name, ev.event_id, ev.custom_data.value, ev.custom_data.currency], ['Purchase', 'pay_meta', 250, 'USD']);
assert.deepEqual(ev.user_data.em, [await sha('elise@example.de')]);
assert.equal(await finalizeTourBooking(capiEnv, db, { verified: vc }), 'duplicate');
assert.equal(metaCalls.length, 1, 'a repeat never sends a second Purchase');
// a booking without consent: no Purchase to Meta
assert.equal(await finalizeTourBooking(capiEnv, db, { verified: bookingFromOrder('pay_nometa', 'o_nometa', order(25000, { date: '2026-12-21' })) }), 'inserted');
assert.equal(metaCalls.length, 1, 'no consent at checkout: nothing sent');
console.log('booking tests ok');
