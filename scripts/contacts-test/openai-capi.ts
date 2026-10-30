// Checks src/lib/openaiCapi.ts: the server's copy of the OpenAI pixel events is shaped as OpenAI asks, uses the same
// id as the browser's copy, and is sent only with a key and the visitor's consent.
import assert from 'node:assert/strict';
import { buildOpenAiEvent, sendOpenAiEvent, OPENAI_PIXEL_ID } from '../../src/lib/openaiCapi';
import { metaContextFromRequest, sha256 } from '../../src/lib/metaCapi';
import { packMeta, unpackMeta } from '../../src/lib/payments/orderNotes';

const calls: { url: string; auth: string; body: any }[] = [];
let status = 200;
(globalThis as any).fetch = async (url: string, init: any) => {
  calls.push({ url, auth: init.headers.Authorization, body: JSON.parse(init.body) });
  return new Response('{}', { status });
};

const order = { id: 'pay_abc', type: 'order_created' as const, sourceUrl: 'https://www.iwisglobal.com/booking/confirmation', amountMinor: 1200000, currency: 'inr', contentIds: ['SAME_DAY_AGRA_DELHI'], quantity: 2 };

// Shape: whole minor units, upper-case currency, content lines with the traveller count.
const ev: any = await buildOpenAiEvent(order, {}, 1700000000000);
assert.deepEqual(ev, {
  id: 'pay_abc', type: 'order_created', timestamp_ms: 1700000000000, source_url: order.sourceUrl, action_source: 'web',
  data: { type: 'contents', amount: 1200000, currency: 'INR', contents: [{ id: 'SAME_DAY_AGRA_DELHI', content_type: 'product', quantity: 2 }] },
});
const lead: any = await buildOpenAiEvent({ id: 'lead_1', type: 'lead_created', sourceUrl: 'https://www.iwisglobal.com/contact' }, {}, 5);
assert.deepEqual(lead.data, { type: 'customer_action' });
// With nothing known about the visitor there is no user object and no click reference.
assert.equal('user' in ev, false);
assert.equal('oppref' in ev, false);

// With identifiers: click references as the pixel wrote them, hashed email and external id (OpenAI's normalisation:
// email trimmed and lower-cased, external id trimmed with its case kept), IP and browser string.
const ctx = { consent: true, ip: '203.0.113.7', userAgent: 'Mozilla/5.0 test', oppref: 'oppref_AbC-123', obref: '123e4567-e89b-42d3-a456-426614174000' };
const full: any = await buildOpenAiEvent({ ...order, email: '  Elise@Example.DE ', externalId: ' Cust_Abc ' }, ctx, 1);
assert.equal(full.oppref, 'oppref_AbC-123');
assert.equal(full.user.obref, ctx.obref);
assert.deepEqual(full.user.emails_sha256, [await sha256('elise@example.de')]);
assert.deepEqual(full.user.external_ids_sha256, [await sha256('Cust_Abc')]);
assert.equal(full.user.ip_address, '203.0.113.7');
assert.equal(full.user.user_agent, 'Mozilla/5.0 test');
// Nothing readable goes out: the address, name and phone never appear in clear text.
assert.equal(JSON.stringify(full).includes('elise'), false);
assert.equal(JSON.stringify(full).includes('Elise'), false);
assert.equal(JSON.stringify(full).includes('Cust_Abc'), false);
// A blank or invalid address adds no hash.
assert.equal(((await buildOpenAiEvent({ ...order, email: 'nonsense' }, ctx)) as any).user.emails_sha256, undefined);

// The click references are read from the pixel's cookies, only with consent, and survive the order note whole.
const req = (cookie: string) => new Request('https://www.iwisglobal.com/api/create-order', { headers: { cookie, 'user-agent': 'UA', 'cf-connecting-ip': '198.51.100.9' } });
const got = metaContextFromRequest(req('cookie_consent=granted; __oppref=oppref_AbC-123; __obref=123e4567-e89b-42d3-a456-426614174000'));
assert.equal(got.oppref, 'oppref_AbC-123');
assert.equal(got.obref, '123e4567-e89b-42d3-a456-426614174000');
assert.equal(metaContextFromRequest(req('cookie_consent=denied; __oppref=x')).consent, false);
assert.equal(metaContextFromRequest(req('cookie_consent=denied; __oppref=x')).oppref, undefined, 'no consent: no click reference is kept');
const note = packMeta({ ...got, fbc: 'f'.repeat(300), userAgent: 'u'.repeat(400) });
assert.ok(note.length <= 255, 'the order note fits Razorpay');
const back = unpackMeta(note);
assert.equal(back.oppref, 'oppref_AbC-123', 'the click reference is never shortened');
assert.equal(back.obref, '123e4567-e89b-42d3-a456-426614174000');
assert.equal(back.consent, true);
// One that could not fit is left out rather than cut.
assert.equal(unpackMeta(packMeta({ ...got, oppref: 'o'.repeat(200) })).oppref, '');

const key = { OPENAI_ADS_API_KEY: 'sk-test' };
const consentOnly = { consent: true };
assert.equal(await sendOpenAiEvent({}, order, { consent: true }), false, 'no key: nothing sent');
assert.equal(await sendOpenAiEvent(key, order, { consent: false }), false, 'no consent: nothing sent');
assert.equal(await sendOpenAiEvent(key, { ...order, id: '' }, { consent: true }), false, 'no id: nothing sent');
assert.equal(calls.length, 0);

assert.equal(await sendOpenAiEvent(key, order, { consent: true }), true);
assert.equal(calls.length, 1);
assert.equal(calls[0].url, `https://bzr.openai.com/v1/events?pid=${OPENAI_PIXEL_ID}`);
assert.equal(calls[0].auth, 'Bearer sk-test');
assert.equal(calls[0].body.validate_only, false);
assert.equal(calls[0].body.events.length, 1);
assert.equal(calls[0].body.events[0].id, 'pay_abc');
await sendOpenAiEvent(key, { ...order, id: 'pay_full', email: 'a@b.de' }, ctx);
assert.equal(calls[calls.length - 1].body.events[0].oppref, 'oppref_AbC-123');
assert.equal(calls[calls.length - 1].body.events[0].user.emails_sha256.length, 1);
calls.pop();

await sendOpenAiEvent({ ...key, OPENAI_ADS_PIXEL_ID: 'OTHER' }, order, { consent: true });
assert.ok(calls[1].url.endsWith('pid=OTHER'), 'a configured pixel id wins');

// A refusal or a network failure never throws and reports false.
status = 401;
assert.equal(await sendOpenAiEvent(key, order, { consent: true }), false);
(globalThis as any).fetch = async () => { throw new Error('down'); };
assert.equal(await sendOpenAiEvent(key, order, { consent: true }), false);

console.log('openai capi tests ok');
