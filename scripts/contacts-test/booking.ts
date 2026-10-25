// Checks src/lib/tourBooking.ts and the order-notes packing: a paid tour booking is recorded once whichever of the
// browser or the payment webhook arrives first, at the amount Razorpay charged, with the ad it came from.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { finalizeTourBooking } from '../../src/lib/tourBooking';
import { bookingFromOrder } from '../../src/lib/payments/razorpay';
import { packAttribution, packGuest, unpackAttribution, unpackGuest, attributionFromBody } from '../../src/lib/payments/orderNotes';

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
const refunds: string[] = [];
(globalThis as any).fetch = async (url: string, init: any) => {
  if (url.includes('api.resend.com')) { emails.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); }
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
for (let i = 0; i < 4; i++) {
  assert.equal(await finalizeTourBooking(env, db, { verified: bookingFromOrder(`pay_f${i}`, `o_f${i}`, order(1000, { date: '2026-12-09', travelers: '3' })) }), 'inserted');
}
const before = emails.length;
assert.equal(await finalizeTourBooking(env, db, { verified: bookingFromOrder('pay_over', 'o_over', order(1000, { date: '2026-12-09', travelers: '1' })) }), 'refunded');
assert.equal(refunds.length, 1); assert.ok(refunds[0].includes('/payments/pay_over/refund'));
assert.equal(count('bookings', `payment_id = 'pay_over'`), 0);
assert.equal(emails.length, before);
console.log('booking tests ok');
