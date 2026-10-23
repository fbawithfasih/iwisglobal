// Checks src/lib/campaigns.ts (audience, test send, batches, safety gates, translation) against in-memory SQLite with Resend and Anthropic stubbed.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import * as C from '../../src/lib/contacts';
import * as K from '../../src/lib/marketing';
import * as G from '../../src/lib/campaigns';

const raw = new DatabaseSync(':memory:');
for (const f of ['schema.sql', 'schema_crm.sql', 'schema_booking_locale.sql', 'schema_deposit_payments.sql', 'schema_whatsapp.sql', 'schema_contacts.sql', 'schema_marketing.sql', 'schema_campaigns.sql']) {
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

// ---- stubs: Resend (single and batch) and Anthropic
const singles: any[] = [];
const batches: { key: string; body: any[] }[] = [];
let batchMode: 'ok' | '429' | '422' = 'ok';
(globalThis as any).fetch = async (url: string, init: any) => {
  if (url.endsWith('/emails/batch')) {
    const body = JSON.parse(init.body);
    batches.push({ key: init.headers['Idempotency-Key'], body });
    if (batchMode === '429') return new Response(JSON.stringify({ message: 'rate limit' }), { status: 429 });
    if (batchMode === '422') return new Response(JSON.stringify({ message: 'invalid' }), { status: 422 });
    return new Response(JSON.stringify({ data: body.map((_: any, i: number) => ({ id: `re_${batches.length}_${i}` })) }), { status: 200 });
  }
  if (url.endsWith('/emails')) { singles.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); }
  if (url.includes('anthropic.com')) {
    return new Response(JSON.stringify({ content: [{ type: 'text', text: '```json\n' + JSON.stringify({ subject: 'Betreff', preheader: '', headline: 'Überschrift', intro: 'Einleitung', block1: '', block2: '', block3: '', cta_label: 'Los' }) + '\n```' }], usage: {} }), { status: 200 });
  }
  return new Response('{}', { status: 404 });
};

const env: Record<string, any> = { RESEND_API_KEY: 're_x', MARKETING_EMAIL_FROM: 'IWIS Global <news@news.iwisglobal.com>', MARKETING_SENDING_ENABLED: '1', UNSUBSCRIBE_SECRET: 'unsub-secret', ANTHROPIC_API_KEY: 'k' };

// ---- people: 4 English and 2 German subscribers, one pending, one unsubscribed
async function subscriber(email: string, language: string, country: string, confirm = true) {
  const p = await C.upsertPerson(db, [{ type: 'email', value: email }], { language, country });
  await C.recordConsent(db, p.personId, { channel: 'email', action: 'granted', source: 'website_form' });
  if (confirm) await C.recordConsent(db, p.personId, { channel: 'email', action: 'confirmed', source: 'double_opt_in' });
  return p.personId;
}
const en1 = await subscriber('en1@example.com', 'en', 'US');
for (const [e, l, c] of [['en2@example.com', 'en', 'GB'], ['en3@example.com', '', 'IN'], ['en4@example.com', 'en', 'US'], ['de1@example.com', 'de', 'DE'], ['de2@example.com', 'de', 'AT']] as const) await subscriber(e, l, c);
await subscriber('pending@example.com', 'en', 'US', false);
const gone = await subscriber('gone@example.com', 'en', 'US');
await K.unsubscribePerson(db, gone);

// ---- audience only ever contains confirmed subscribers, and filters narrow it
const all = await G.audience(db, {});
assert.equal(all.length, 6, 'pending and unsubscribed are excluded');
assert.equal((await G.audience(db, { languages: ['de'] })).length, 2);
assert.equal((await G.audience(db, { languages: ['en'] })).length, 4, 'no recorded language counts as English');
assert.equal((await G.audience(db, { countries: ['DE', 'AT'] })).length, 2);
assert.equal((await G.audience(db, { pastBooker: true })).length, 0);
assert.deepEqual(G.languageCounts(all), { en: 4, de: 2 });

// ---- content and gates
const id = await G.createCampaign(db, 'Autumn', 'admin');
let camp = (await G.getCampaign(db, id))!;
await G.saveContent(db, id, { ...G.EMPTY_CONTENT('en'), subject: 'Autumn in Agra', preheader: 'Cooler days', headline: 'Autumn is here', intro: 'Hello\n\nSecond paragraph', cta_label: 'See tours', cta_url: 'https://www.iwisglobal.com/tours', reviewed: 1 });
await G.saveContent(db, id, { ...G.EMPTY_CONTENT('de'), subject: 'Herbst in Agra', headline: 'Der Herbst ist da', intro: 'Hallo', reviewed: 0 });
let probs = await G.readiness(env, db, camp);
assert.deepEqual(probs, ['Send yourself a test first.']);
assert.ok((await G.readiness({ ...env, MARKETING_SENDING_ENABLED: '0' }, db, camp)).some((p) => p.includes('switched off')));
assert.ok((await G.readiness({ ...env, MARKETING_EMAIL_FROM: '' }, db, camp)).some((p) => p.includes('sender address')));
assert.ok((await G.startCampaign(env, db, camp)).includes('Send yourself a test first.'), 'cannot start without a test send');
assert.equal((await G.getCampaign(db, id))!.status, 'draft');

// ---- test send: marked, capped at 5, unlocks the real send, touches no ledger
const t = await G.sendTest(env, db, camp, ['me@example.com', 'bad', 'a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com'], 'en');
assert.equal(t.sent, 5); assert.equal(singles.length, 5); assert.ok(singles[0].subject.startsWith('[TEST] '));
assert.equal(count('campaign_sends'), 0);
assert.ok(singles[0].html.includes('/unsubscribe/test') && singles[0].html.includes('Agra &ndash; 282001'), 'footer has the unsubscribe link and the postal address');
camp = (await G.getCampaign(db, id))!;
assert.ok(camp.tested_at);
assert.deepEqual(await G.readiness(env, db, camp), []);

// ---- an unapproved translation is never sent: German readers get English
const content = await G.loadContent(db, id);
assert.equal(G.languageFor('de', content), 'en'); assert.equal(G.languageFor('en', content), 'en'); assert.equal(G.languageFor('fr', content), 'en');

// ---- start, then send in chunks
assert.deepEqual(await G.startCampaign(env, db, camp), []);
assert.equal(count('campaign_sends', `campaign_id = '${id}'`), 6);
assert.equal(count('campaign_sends', `language = 'de'`), 0, 'everyone queued as English while German is unapproved');
assert.deepEqual(await G.startCampaign(env, db, (await G.getCampaign(db, id))!), ['This campaign has already been started.']);

// one person unsubscribes after queuing: skipped, never in the batch
const en4 = (raw.prepare(`SELECT person_id FROM campaign_sends WHERE email = 'en4@example.com'`).get() as any).person_id;
await K.unsubscribePerson(db, en4);
let r = await G.sendNextChunk(env, db, id);
assert.deepEqual([r.sent, r.skipped, r.failed, r.remaining], [5, 1, 0, 0]);
assert.equal(batches.length, 1); assert.equal(batches[0].body.length, 5);
assert.ok(!batches[0].body.some((m) => m.to[0] === 'en4@example.com'));
const first = batches[0].body[0];
assert.equal(first.from, env.MARKETING_EMAIL_FROM);
assert.equal(first.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
const link = /<(https:\/\/www\.iwisglobal\.com\/unsubscribe\/[^>]+)>/.exec(first.headers['List-Unsubscribe'])![1];
const pid = await K.verifyUnsubscribeToken(env.UNSUBSCRIBE_SECRET, decodeURIComponent(link.split('/unsubscribe/')[1].split('?')[0]));
assert.ok(pid && pid.startsWith('per_'), 'each email carries a valid personal unsubscribe link');
assert.ok(first.html.includes(link.replace(/&/g, '&amp;')) || first.html.includes(link), 'and the same link in the body');
assert.equal(count('campaign_sends', `status = 'sent' AND resend_id != ''`), 5);
assert.equal((await G.getCampaign(db, id))!.status, 'sent');
r = await G.sendNextChunk(env, db, id);
assert.equal(r.blocked, 'not sending', 'a finished campaign sends nothing more');
assert.equal(batches.length, 1);

// ---- approved translation: German readers get German
await G.saveContent(db, id, { ...G.EMPTY_CONTENT('de'), subject: 'Herbst in Agra', headline: 'Der Herbst ist da', intro: 'Hallo', reviewed: 1 });
assert.equal(G.languageFor('de', await G.loadContent(db, id)), 'de');

// ---- daily cap, switch, throttling, rejection
async function newCampaign(name: string) {
  const cid = await G.createCampaign(db, name, 'admin');
  await G.saveContent(db, cid, { ...G.EMPTY_CONTENT('en'), subject: name, headline: name, intro: 'Hi', reviewed: 1 });
  raw.exec(`UPDATE campaigns SET tested_at = '2026-01-01T00:00:00.000Z' WHERE id = '${cid}'`);
  return cid;
}
const c2 = await newCampaign('Capped');
assert.deepEqual(await G.startCampaign(env, db, (await G.getCampaign(db, c2))!), []);
const before = batches.length;
assert.equal((await G.sendNextChunk({ ...env, MARKETING_SENDING_ENABLED: '0' }, db, c2)).blocked, 'Sending is switched off.');
assert.equal(batches.length, before, 'nothing goes out while switched off');
const capped = await G.sendNextChunk({ ...env, MARKETING_DAILY_CAP: '1' }, db, c2);
assert.equal(capped.blocked, 'Daily sending limit reached; it continues tomorrow.');
const r429 = (() => { batchMode = '429'; return G.sendNextChunk(env, db, c2); })();
const x = await r429;
assert.ok(x.blocked && x.sent === 0, 'throttled: nothing marked sent');
assert.ok(count('campaign_sends', `campaign_id = '${c2}' AND status = 'queued'`) >= 1);
const keyThrottled = batches[batches.length - 1].key;
batchMode = 'ok';
const ok2 = await G.sendNextChunk(env, db, c2);
assert.ok(ok2.sent >= 1);
assert.equal(batches[batches.length - 1].key, keyThrottled, 'a retry reuses the same Idempotency-Key');
assert.equal((await G.getCampaign(db, c2))!.status, 'sent');

const c3 = await newCampaign('Rejected');
await G.startCampaign(env, db, (await G.getCampaign(db, c3))!);
batchMode = '422';
const rej = await G.sendNextChunk(env, db, c3);
assert.ok(rej.failed >= 1 && count('campaign_sends', `campaign_id = '${c3}' AND status = 'queued'`) === 0, 'a rejection is not retried forever');
batchMode = 'ok';

// ---- missing sender settings block real sends
const c4 = await newCampaign('NoFrom');
assert.ok((await G.startCampaign({ ...env, MARKETING_EMAIL_FROM: '' }, db, (await G.getCampaign(db, c4))!)).length > 0);

// ---- scheduled campaigns start by themselves
const c5 = await newCampaign('Scheduled');
await G.schedule(db, c5, '2026-01-02T00:00:00.000Z');
assert.equal((await G.getCampaign(db, c5))!.status, 'scheduled');
const tk = await G.tick(env, db, async () => {});
assert.equal(tk.started, 1);
assert.equal((await G.getCampaign(db, c5))!.status, 'sent');

// ---- translation: JSON in fences is parsed and saved UNAPPROVED
assert.equal(G.parseTranslation('not json'), null);
assert.ok(G.parseTranslation('{"subject":"a","headline":"b","intro":"c"}'));
const c6 = await newCampaign('Translate');
assert.equal(await G.translateContent(env, db, c6, 'de'), null);
const de = (await G.loadContent(db, c6)).de;
assert.equal(de.subject, 'Betreff'); assert.equal(de.reviewed, 0, 'a machine translation starts unapproved');
assert.equal(await G.translateContent({ ...env, ANTHROPIC_API_KEY: '' }, db, c6, 'de'), 'Translation is not configured (ANTHROPIC_API_KEY).');

// ---- cancelling stops everyone not yet sent
const c7 = await newCampaign('Cancel');
await G.startCampaign(env, db, (await G.getCampaign(db, c7))!);
await G.cancelCampaign(db, c7);
assert.equal(count('campaign_sends', `campaign_id = '${c7}' AND status = 'queued'`), 0);
assert.equal((await G.getCampaign(db, c7))!.status, 'cancelled');
console.log('campaigns tests ok');
