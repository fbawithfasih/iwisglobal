// Checks src/lib/meta.ts (Facebook/Instagram lead ads and DMs) against in-memory SQLite with a stubbed Graph API.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import * as M from '../../src/lib/meta';
import { verifySignature } from '../../src/lib/whatsapp';

const raw = new DatabaseSync(':memory:');
for (const f of ['schema.sql', 'schema_crm.sql', 'schema_booking_locale.sql', 'schema_deposit_payments.sql', 'schema_whatsapp.sql', 'schema_contacts.sql', 'schema_meta.sql', 'schema_marketing.sql']) {
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
const env = { META_PAGE_ACCESS_TOKEN: 'test-token', META_PAGE_ID: 'page1' };

// ---- signature
const secret = 'app-secret';
const body = JSON.stringify({ object: 'page', entry: [] });
const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
assert.equal(await verifySignature(body, sig, secret), true);
assert.equal(await verifySignature(body + ' ', sig, secret), false, 'changed body rejected');
assert.equal(await verifySignature(body, sig, 'other'), false);

// ---- parsing
const leadHook = { object: 'page', entry: [{ id: 'page1', changes: [{ field: 'leadgen', value: { leadgen_id: 'L1', page_id: 'page1', form_id: 'F1', ad_id: 'A1', created_time: 1790000000 } }] }] };
const igHook = { object: 'instagram', entry: [{ id: 'ig1', messaging: [
  { sender: { id: 'IGSID1' }, recipient: { id: 'ig1' }, timestamp: 1790000100000, message: { mid: 'm_ig_1', text: 'Hi, Taj sunrise for 2 in March? my mail is Sam.Traveller@gmail.com' } },
  { sender: { id: 'ig1' }, recipient: { id: 'IGSID1' }, timestamp: 1790000200000, message: { mid: 'm_echo', text: 'our reply', is_echo: true } },
  { sender: { id: 'IGSID1' }, recipient: { id: 'ig1' }, timestamp: 1790000300000, read: { mid: 'm_ig_1' } },
] }] };
const fbHook = { object: 'page', entry: [{ id: 'page1', messaging: [{ sender: { id: 'PSID1' }, recipient: { id: 'page1' }, timestamp: 1790000400000, message: { mid: 'm_fb_1', text: 'Price for Agra day tour?' } }] }] };
assert.equal(M.parseMetaWebhook(leadHook).length, 1);
assert.equal(M.parseMetaWebhook(igHook).length, 1, 'echo and read receipt skipped');
assert.equal(M.parseMetaWebhook(fbHook)[0].kind, 'dm');
assert.deepEqual(M.extractContacts('call +91 98765 43210 or a@b.co'), { email: 'a@b.co', phone: '+91 98765 43210' });

// ---- field mapping: a standard form is not consent
const std = M.mapLeadFields([{ name: 'full_name', values: ['Ada L'] }, { name: 'email', values: ['ada@example.com'] }, { name: 'phone_number', values: ['+4915112345678'] }]);
assert.equal(std.name, 'Ada L'); assert.equal(std.consent, null);
const custom = M.mapLeadFields([{ name: 'first_name', values: ['Bo'] }, { name: 'last_name', values: ['King'] }, { name: 'email', values: ['bo@example.com'] },
  { name: 'which_tour_are_you_interested_in', values: ['Taj Mahal sunrise'] }, { name: 'travel_dates', values: ['March 2027'] }, { name: 'how_many_travellers', values: ['3'] },
  { name: 'i_agree_to_receive_marketing_emails', values: ['Yes'] }]);
assert.equal(custom.name, 'Bo King'); assert.equal(custom.tour, 'Taj Mahal sunrise'); assert.equal(custom.dates, 'March 2027'); assert.equal(custom.partySize, 3); assert.equal(custom.consent, true);
assert.equal(M.mapLeadFields([{ name: 'marketing_consent', values: ['No'] }]).consent, false);
// a custom Yes/No question as Meta names it (lower-cased question, option text as the value)
assert.equal(M.mapLeadFields([{ name: 'would_you_like_occasional_travel_ideas_by_email?', values: ['Yes'] }]).consent, true);
assert.equal(M.mapLeadFields([{ name: 'email_me_travel_ideas', values: ['yes,_email_me'] }]).consent, true);
assert.equal(M.mapLeadFields([{ name: 'would_you_like_occasional_travel_ideas_by_email?', values: ['No'] }]).consent, false);
// privacy-step checkboxes come back separately: a consent-named one counts, a privacy-policy one never does
const std2 = [{ name: 'email', values: ['a@example.com'] }];
assert.equal(M.mapLeadFields(std2, [{ checkbox_key: 'email_updates', is_checked: '1' }]).consent, true);
assert.equal(M.mapLeadFields(std2, [{ checkbox_key: 'email_updates', is_checked: '0' }]).consent, false);
assert.equal(M.mapLeadFields(std2, [{ checkbox_key: 'privacy_policy', is_checked: '1' }]).consent, null, 'accepting the policy is not marketing consent');
assert.equal(M.mapLeadFields(std2, [{ checkbox_key: 'privacy_policy', is_checked: '1' }, { checkbox_key: 'marketing_emails', is_checked: '0' }]).consent, false);
assert.equal(M.mapLeadFields(std2, [{ checkbox_key: 'marketing_emails', is_checked: true }]).consent, true);
assert.equal(M.mapLeadFields(std2, [{ checkbox_key: 'privacy_policy', is_checked: '1' }]).answers['checkbox:privacy_policy'], 'checked', 'kept as an answer');

// ---- stubbed Graph API
let calls = 0;
const requested: string[] = [];
const leadObj = (id: string, email: string, consent?: string) => ({
  id, created_time: new Date(Date.now() - 3600_000).toISOString().replace(/\.\d{3}Z$/, '+0000'), ad_id: 'A1', ad_name: 'Taj ad', campaign_name: 'Autumn Taj', form_id: 'F1', platform: 'ig', is_organic: false,
  field_data: [{ name: 'full_name', values: ['Lead ' + id] }, { name: 'email', values: [email] }, ...(consent ? [{ name: 'marketing_consent', values: [consent] }] : [])],
});
const graph: typeof fetch = async (url: any) => {
  calls++;
  const u = String(url);
  const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
  if (u.includes('/L1?')) return json(leadObj('L1', 'lead1@example.com'));
  if (u.includes('/L2?')) return json(leadObj('L2', 'lead2@example.com', 'Yes'));
  if (u.includes('/L20?')) { requested.push(u); return json({ ...leadObj('L20', 'lead20@example.com'), custom_disclaimer_responses: [{ checkbox_key: 'privacy_policy', is_checked: '1' }, { checkbox_key: 'email_updates', is_checked: '1' }] }); }
  if (u.includes('/L21?')) return json({ ...leadObj('L21', 'lead21@example.com'), custom_disclaimer_responses: [{ checkbox_key: 'privacy_policy', is_checked: '1' }] });
  if (u.includes('/page1/leadgen_forms')) return json({ data: [{ id: 'F1' }] });
  if (u.includes('/F1/leads')) return json({ data: [leadObj('L3', 'lead3@example.com'), { ...leadObj('L_OLD', 'old@example.com'), created_time: '2020-01-01T00:00:00+0000' }] });
  if (u.includes('/IGSID1?')) return json({ name: 'Sam Traveller', username: 'sam' });
  return new Response('{}', { status: 400 });
};

// lead ad webhook -> lead with campaign and ad
let fresh = await M.storeMetaEvents(db, M.parseMetaWebhook(leadHook));
assert.equal(fresh.length, 1);
assert.deepEqual(await M.processMetaEvents(env, db, fresh, graph), { done: 1, failed: 0 });
const l1 = raw.prepare(`SELECT * FROM leads WHERE email = 'lead1@example.com'`).get() as any;
assert.equal(l1.channel, 'fb_lead_ad'); assert.equal(l1.status, 'new'); assert.equal(l1.name, 'Lead L1');
const t1 = raw.prepare(`SELECT * FROM touchpoints WHERE external_ref = 'L1'`).get() as any;
assert.equal(t1.campaign, 'Autumn Taj'); assert.equal(t1.ad_id, 'A1'); assert.equal(t1.form_id, 'F1'); assert.equal(t1.source, 'instagram');
assert.equal(count('consent_events'), 0, 'standard form gives no consent');
// replay of the same webhook: nothing new
fresh = await M.storeMetaEvents(db, M.parseMetaWebhook(leadHook));
assert.equal(fresh.length, 0); assert.equal(count('leads', `email = 'lead1@example.com'`), 1);

// explicit consent question -> consent event, status pending
fresh = await M.storeMetaEvents(db, [{ kind: 'leadgen', externalId: 'L2', payload: { leadgen_id: 'L2', page_id: 'page1', form_id: 'F1', ad_id: 'A1', created_time: 1 } }]);
await M.processMetaEvents(env, db, fresh, graph);
assert.equal(count('consent_events', `source = 'meta_lead_ad' AND text_version_id = 'meta-form-F1'`), 1);
const p2 = raw.prepare(`SELECT p.marketing_status AS s FROM leads l JOIN people p ON p.id = l.person_id WHERE l.email = 'lead2@example.com'`).get() as any;
assert.equal(p2.s, 'pending');

// consent given with a privacy-step checkbox (a separate field of the lead) -> pending; accepting the policy alone -> nothing
const before20 = count('consent_events');
fresh = await M.storeMetaEvents(db, [{ kind: 'leadgen', externalId: 'L20', payload: { leadgen_id: 'L20', page_id: 'page1', form_id: 'F1', ad_id: 'A1', created_time: 1 } }]);
await M.processMetaEvents(env, db, fresh, graph);
assert.ok(requested[0].includes('custom_disclaimer_responses'), 'the checkbox answers are asked for');
assert.equal(count('consent_events'), before20 + 1);
assert.equal((raw.prepare(`SELECT p.marketing_status AS s FROM leads l JOIN people p ON p.id = l.person_id WHERE l.email = 'lead20@example.com'`).get() as any).s, 'pending');
fresh = await M.storeMetaEvents(db, [{ kind: 'leadgen', externalId: 'L21', payload: { leadgen_id: 'L21', page_id: 'page1', form_id: 'F1', ad_id: 'A1', created_time: 1 } }]);
await M.processMetaEvents(env, db, fresh, graph);
assert.equal(count('consent_events'), before20 + 1, 'accepting the privacy policy is not marketing consent');

// Instagram DM: ig_sid person, email in the text links an identifier, name from the profile call
fresh = await M.storeMetaEvents(db, M.parseMetaWebhook(igHook));
await M.processMetaEvents(env, db, fresh, graph);
const dm = raw.prepare(`SELECT l.*, p.display_name FROM leads l JOIN people p ON p.id = l.person_id WHERE l.channel = 'instagram_dm'`).get() as any;
assert.equal(dm.display_name, 'Sam Traveller'); assert.equal(dm.email, 'Sam.Traveller@gmail.com');
assert.equal(count('person_identifiers', `type = 'ig_sid' AND value_norm = 'IGSID1'`), 1);
assert.equal(count('person_identifiers', `person_id = '${dm.person_id}' AND type = 'email'`), 1);
// Messenger DM
fresh = await M.storeMetaEvents(db, M.parseMetaWebhook(fbHook));
await M.processMetaEvents(env, db, fresh, graph);
assert.equal(count('leads', `channel = 'facebook_dm'`), 1);

// a failed fetch is kept and retried by the poll
fresh = await M.storeMetaEvents(db, [{ kind: 'leadgen', externalId: 'L9', payload: { leadgen_id: 'L9', page_id: 'page1', form_id: 'F1', ad_id: '', created_time: 1 } }]);
const bad = await M.processMetaEvents(env, db, fresh, graph);
assert.equal(bad.failed, 1);
assert.equal((raw.prepare(`SELECT status FROM meta_events WHERE external_id = 'L9'`).get() as any).status, 'failed');

// poll: finds L3 (missed by the webhook), ignores the 2020 lead, does not retry L9 within 5 minutes
const before = count('leads');
const polled = await M.pollMeta(env, db, graph);
assert.equal(polled.found, 1); assert.equal(count('leads'), before + 1);
assert.equal(count('leads', `email = 'old@example.com'`), 0, 'old lead outside the look-back is ignored');
const again = await M.pollMeta(env, db, graph);
assert.equal(again.found, 0, 'second poll finds nothing new');
raw.exec(`UPDATE meta_events SET updated_at = '2000-01-01T00:00:00.000Z' WHERE external_id = 'L9'`);
assert.equal((await M.pollMeta(env, db, graph)).retried, 0, 'still failing, not counted as done');
assert.ok(calls > 0);

// ---- the reason Meta refused a lead fetch is kept, so the admin page can show it
const refuse: typeof fetch = async () => new Response(JSON.stringify({ error: { code: 200, message: 'Requires leads_retrieval permission' } }), { status: 400 });
fresh = await M.storeMetaEvents(db, [{ kind: 'leadgen', externalId: 'L10', payload: { leadgen_id: 'L10', page_id: 'page1', form_id: 'F1', ad_id: '', created_time: 1 } }]);
await M.processMetaEvents(env, db, fresh, refuse);
const why = raw.prepare(`SELECT status, error FROM meta_events WHERE external_id = 'L10'`).get() as any;
assert.equal(why.status, 'failed'); assert.ok(why.error.includes('#200') && why.error.includes('leads_retrieval'), why.error);

// ---- a system-user token is exchanged for the Page token before leads are read
const seen: string[] = [];
const exch: typeof fetch = async (url: any, init: any) => {
  const u = String(url);
  const auth = String(init?.headers?.Authorization ?? '');
  if (u.includes('/page1?fields=access_token')) { assert.equal(auth, 'Bearer SYSTEM-USER-TOKEN'); return new Response(JSON.stringify({ access_token: 'PAGE-TOKEN' }), { status: 200 }); }
  seen.push(auth);
  if (u.includes('/L11?')) return new Response(JSON.stringify(leadObj('L11', 'lead11@example.com')), { status: 200 });
  return new Response('{}', { status: 400 });
};
const env2 = { META_PAGE_ACCESS_TOKEN: 'SYSTEM-USER-TOKEN', META_PAGE_ID: 'page1' };
fresh = await M.storeMetaEvents(db, [{ kind: 'leadgen', externalId: 'L11', payload: { leadgen_id: 'L11', page_id: 'page1', form_id: 'F1', ad_id: '', created_time: 1 } }]);
assert.deepEqual(await M.processMetaEvents(env2, db, fresh, exch), { done: 1, failed: 0 });
assert.ok(seen.length > 0 && seen.every((a) => a === 'Bearer PAGE-TOKEN'), 'lead read uses the Page token');

// ---- connection test: readable lines, never a token
const diag: typeof fetch = async (url: any, init: any) => {
  const u = String(url);
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
  if (u.includes('me/assigned_pages')) return json({ data: [{ id: '555', name: 'Other Page', tasks: ['MANAGE'] }] });
  if (u.includes('/me/permissions')) return json({ data: [{ permission: 'pages_show_list', status: 'granted' }] });
  if (u.includes('/me?')) return json({ id: '99', name: 'iwis-leads' });
  if (u.includes('/page1?fields=id,name,access_token')) return json({ id: 'page1', name: 'IWIS Global', access_token: 'SECRET-PAGE-TOKEN' });
  if (u.includes('/leadgen_forms')) return json({ data: [{ id: 'F1' }] });
  return json({ error: { code: 100, message: 'Unsupported get request' } }, 400);
};
const lines = await M.diagnoseMeta({ META_PAGE_ACCESS_TOKEN: 'SECRET-SYSTEM-TOKEN', META_PAGE_ID: 'page1' }, db, diag);
const text = lines.join('\n');
assert.ok(text.includes('iwis-leads') && text.includes('leads_retrieval is NOT') && text.includes('Page access token was obtained from the saved token: yes') && text.includes('cannot be read'));
assert.ok(!text.includes('SECRET'), 'no token in the output');
assert.ok(text.includes('Other Page (id 555; tasks: MANAGE)') && text.includes('is NOT among them'), text);
console.log('meta tests ok');
