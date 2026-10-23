// Checks Resend webhooks, click-tracked links and the lead report (src/lib/resendEvents.ts, campaigns.ts, leadReport.ts).
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import * as C from '../../src/lib/contacts';
import * as G from '../../src/lib/campaigns';
import * as E from '../../src/lib/resendEvents';
import * as R from '../../src/lib/leadReport';

const raw = new DatabaseSync(':memory:');
for (const f of ['schema.sql', 'schema_crm.sql', 'schema_booking_locale.sql', 'schema_deposit_payments.sql', 'schema_whatsapp.sql', 'schema_contacts.sql', 'schema_marketing.sql', 'schema_campaigns.sql', 'schema_events.sql']) {
  for (const stmt of readFileSync(`${process.env.ROOT}/${f}`, 'utf8').replace(/^\s*--.*$/gm, '').split(';')) {
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
const status = (id: string) => (raw.prepare(`SELECT marketing_status AS s FROM people WHERE id = ?`).get(id) as any).s as string;

// ---- Svix signatures
const secretBytes = 'secretsecretsecret';
const secret = 'whsec_' + btoa(secretBytes);
async function sign(id: string, ts: string, body: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secretBytes), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return 'v1,' + btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${body}`)))));
}
const now = Math.floor(Date.now() / 1000);
const body0 = '{"type":"email.delivered"}';
const sig0 = await sign('msg_1', String(now), body0);
assert.equal(await E.verifySvix(secret, { id: 'msg_1', timestamp: String(now), signature: sig0 }, body0), true);
assert.equal(await E.verifySvix(secret, { id: 'msg_1', timestamp: String(now), signature: 'v1,AAAA ' + sig0 }, body0), true, 'any listed signature may match');
assert.equal(await E.verifySvix(secret, { id: 'msg_1', timestamp: String(now), signature: sig0 }, body0 + ' '), false, 'tampered body');
assert.equal(await E.verifySvix(secret, { id: 'msg_2', timestamp: String(now), signature: sig0 }, body0), false, 'wrong id');
assert.equal(await E.verifySvix(secret, { id: 'msg_1', timestamp: String(now - 3600), signature: await sign('msg_1', String(now - 3600), body0) }, body0), false, 'too old to accept');
assert.equal(await E.verifySvix('whsec_' + btoa('otherothersecret'), { id: 'msg_1', timestamp: String(now), signature: sig0 }, body0), false, 'wrong secret');
assert.equal(await E.verifySvix('', { id: 'msg_1', timestamp: String(now), signature: sig0 }, body0), false, 'no secret configured');

// ---- a sent campaign with click-tracked links
(globalThis as any).fetch = async (url: string, init: any) => {
  if (url.endsWith('/emails/batch')) { const b = JSON.parse(init.body); sentBatch = b; return new Response(JSON.stringify({ data: b.map((_: any, i: number) => ({ id: `re_${i + 1}` })) }), { status: 200 }); }
  return new Response('{}', { status: 200 });
};
let sentBatch: any[] = [];
const env: Record<string, any> = { RESEND_API_KEY: 're_x', MARKETING_EMAIL_FROM: 'IWIS <news@news.iwisglobal.com>', MARKETING_SENDING_ENABLED: '1', UNSUBSCRIBE_SECRET: 's', MARKETING_DAILY_CAP: '1000' };
const ids: string[] = [];
for (const e of ['a@example.com', 'b@example.com', 'c@example.com']) {
  const p = await C.upsertPerson(db, [{ type: 'email', value: e }], { language: 'en', country: 'US' });
  await C.recordConsent(db, p.personId, { channel: 'email', action: 'granted', source: 'website_form' });
  await C.recordConsent(db, p.personId, { channel: 'email', action: 'confirmed', source: 'double_opt_in' });
  ids.push(p.personId);
}
const cid = await G.createCampaign(db, 'Autumn', 'admin');
await G.saveContent(db, cid, { ...G.EMPTY_CONTENT('en'), subject: 'S', headline: 'H', intro: 'I', cta_label: 'Go', cta_url: 'https://www.iwisglobal.com/tours', reviewed: 1 });
raw.exec(`UPDATE campaigns SET tested_at = '2026-01-01T00:00:00.000Z' WHERE id = '${cid}'`);
assert.deepEqual(await G.startCampaign(env, db, (await G.getCampaign(db, cid))!), []);
await G.sendNextChunk(env, db, cid);
assert.equal(sentBatch.length, 3);
const html: string = sentBatch[0].html;
assert.ok(!html.includes('https://www.iwisglobal.com/tours?'), 'the button no longer links straight to the page');
const code = /\/r\/([a-f0-9]{12})/.exec(html)![1];
assert.equal(count('campaign_links', `campaign_id = '${cid}'`), 1, 'one stored link, however many recipients');
const stored = (raw.prepare(`SELECT url FROM campaign_links WHERE code = ?`).get(code) as any).url as string;
assert.ok(stored.startsWith('https://www.iwisglobal.com/tours') && stored.includes('utm_campaign=' + cid), 'redirect target and UTM tags are stored server side');
assert.equal(/\/r\/([a-f0-9]{12})/.exec(sentBatch[2].html)![1], code, 'the same URL always gets the same code');
// test sends link straight through
const t = await G.renderCampaignEmail(db, cid, { ...G.EMPTY_CONTENT('en'), subject: 'S', headline: 'H', intro: 'I', cta_label: 'Go', cta_url: 'https://www.iwisglobal.com/tours' }, { language: 'en', country: '', unsubscribeLink: 'https://x/u' });
assert.ok(!t.html.includes('/r/') && t.html.includes('https://www.iwisglobal.com/tours'));

// ---- events: delivered / duplicate / transient vs permanent bounce / complaint
const ev = (type: string, extra: object = {}) => JSON.stringify({ type, created_at: '2026-10-23T10:00:00.000Z', data: { email_id: 're_1', to: ['a@example.com'], ...extra } });
assert.equal((await E.handleResendEvent(db, 'm1', ev('email.delivered'))).status, 'stored');
assert.equal((await E.handleResendEvent(db, 'm1', ev('email.delivered'))).status, 'duplicate', 'a retried delivery changes nothing');
assert.equal(count('email_events'), 1);
assert.equal((raw.prepare(`SELECT campaign_id FROM email_events WHERE svix_id = 'm1'`).get() as any).campaign_id, cid, 'event is tied to its campaign through the resend id');
assert.equal((await E.handleResendEvent(db, 'm2', 'not json')).status, 'ignored');
assert.equal((await E.handleResendEvent(db, 'm3', JSON.stringify({ type: 'domain.updated', data: {} }))).status, 'ignored');

assert.equal((await E.handleResendEvent(db, 'm4', ev('email.bounced', { bounce: { type: 'Transient', subType: 'MailboxFull' } }))).action, undefined);
assert.equal(status(ids[0]), 'subscribed', 'a full mailbox is not a dead address');
const hard = await E.handleResendEvent(db, 'm5', ev('email.bounced', { bounce: { type: 'Permanent', subType: 'General' } }));
assert.equal(hard.action, 'hard_bounce');
assert.equal(status(ids[0]), 'bounced');
assert.equal(await C.isSuppressed(db, 'email', 'a@example.com'), true);

const spam = await E.handleResendEvent(db, 'm6', ev('email.complained', { email_id: 're_2', to: ['b@example.com'] }));
assert.equal(spam.action, 'complaint');
assert.equal(status(ids[1]), 'complained');
assert.equal(status(ids[2]), 'subscribed');
assert.equal((await G.audience(db, {})).length, 1, 'bounced and complained people drop out of every audience');

const stats = await E.deliveryStats(db, cid);
assert.deepEqual([stats.delivered, stats.bounced, stats.complained], [1, 1, 1], 'counted per email, not per event');

// ---- clicks are aggregate: the table has no person column
assert.ok(!(raw.prepare(`PRAGMA table_info(campaign_clicks)`).all() as any[]).some((c) => /person|email|ip/i.test(c.name)));
raw.exec(`INSERT INTO campaign_clicks (code, day, clicks) VALUES ('${code}', '2026-10-23', 3)`);
assert.deepEqual((await E.clickStats(db, cid)).map((c) => ({ ...c })), [{ url: stored, clicks: 3 }]);

// ---- report
const L = (o: Partial<R.ReportLead>): R.ReportLead => ({ channel: 'website', campaign: '', status: 'new', created_at: '2026-10-01T10:00:00.000Z', first_response_at: null, booking_id: null, amount_paid: null, currency: null, ...o });
const leads = [
  L({ channel: 'fb_lead_ad', campaign: 'autumn', first_response_at: '2026-10-01T10:30:00.000Z' }),
  L({ channel: 'fb_lead_ad', campaign: 'autumn', status: 'quote_sent', first_response_at: '2026-10-01T12:00:00.000Z' }),
  L({ channel: 'fb_lead_ad', campaign: 'autumn', status: 'booked', booking_id: 'b1', amount_paid: 500000, currency: 'INR', first_response_at: '2026-10-01T10:10:00.000Z' }),
  L({ channel: 'fb_lead_ad', campaign: 'autumn', status: 'spam' }),
  L({ channel: 'website', status: 'deposit_paid' }),
  L({ channel: 'website', status: 'lost' }),
];
const spend: R.SpendRow[] = [{ channel: 'fb_lead_ad', campaign: 'autumn', amount_minor: 600000, currency: 'INR' }];
const byCh = R.summarise(leads, spend, 'channel');
const fb = byCh.find((l) => l.key === 'fb_lead_ad')!;
assert.deepEqual([fb.leads, fb.quotes, fb.deposits, fb.bookings], [3, 2, 1, 1], 'spam is left out and a booking counts at every earlier stage');
assert.deepEqual(fb.revenue, { INR: 500000 });
assert.equal(fb.medianResponseMinutes, 30);
assert.deepEqual(R.unitCost(fb.spend, fb.leads), { INR: 200000 });
assert.deepEqual(R.unitCost(fb.spend, fb.bookings), { INR: 600000 });
assert.equal(R.unitCost(fb.spend, 0), null, 'no division by zero');
const web = byCh.find((l) => l.key === 'website')!;
assert.deepEqual([web.leads, web.quotes, web.deposits, web.bookings], [2, 1, 1, 0]);
assert.ok(R.summarise(leads, spend, 'campaign').some((l) => l.key === '(no campaign)'));
assert.equal(await R.addSpend(db, { date: 'x', channel: 'a', campaign: '', amountMajor: 5, currency: 'INR', note: '' }), 'Enter a valid date.');
assert.equal(await R.addSpend(db, { date: '2026-10-01', channel: 'Facebook_Ads', campaign: '', amountMajor: 12.5, currency: 'INR', note: '' }), null);
assert.equal((raw.prepare(`SELECT amount_minor, channel FROM marketing_spend`).get() as any).amount_minor, 1250);
console.log('events tests ok');
