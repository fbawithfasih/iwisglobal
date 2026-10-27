// Pickup details go out through the WhatsApp Business API (src/lib/waPickup.ts): a text inside the 24-hour window, the approved
// template outside it, never to a guest who opted out, and the message lands in the backend inbox.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { sendPickupDetails, pickupText } from '../../src/lib/waPickup';
import { pickupTemplateParams, renderPickupTemplate, type PickupFacts } from '../../src/lib/waTemplates';

const raw = new DatabaseSync(':memory:');
for (const f of ['schema_whatsapp.sql', 'schema_whatsapp_inbox.sql', 'schema_whatsapp_media.sql', 'schema_whatsapp_handler.sql']) {
  for (const stmt of readFileSync(`${process.env.ROOT}/${f}`, 'utf8').replace(/^\s*--.*$/gm, '').split(';')) if (stmt.trim()) raw.exec(stmt.trim());
}
const db: any = { prepare: (q: string) => ({ bind: (...v: unknown[]) => ({
  run: async () => ({ meta: { changes: Number(raw.prepare(q).run(...(v as any)).changes) } }),
  first: async () => (raw.prepare(q).get(...(v as any)) as any) ?? null,
  all: async () => ({ results: raw.prepare(q).all(...(v as any)) as any[] }),
}) }) };

const calls: any[] = [];
let refuse: { code: number; message: string } | null = null;
globalThis.fetch = (async (_url: any, init: any) => {
  const body = JSON.parse(init.body);
  calls.push(body);
  if (refuse) return new Response(JSON.stringify({ error: { message: refuse.message, code: refuse.code } }), { status: 400 });
  return new Response(JSON.stringify({ messages: [{ id: `wamid.${calls.length}` }] }), { status: 200 });
}) as any;
const env = { WHATSAPP_ACCESS_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: '123' };

const facts: PickupFacts = { guestName: 'Dzemal Elezagic', tourTitle: 'Same-Day Taj Mahal Tour', dateLabel: 'Thu, 29 Oct 2026', pickupTime: '7:30 AM', vehicle: 'Innova CRYSTA', driverName: 'Sanjeev Kumar', driverPhone: '+91 98710 33440' };
const NOW = Date.now();
const iso = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const guest = (phone: string, lastWroteHoursAgo: number | null, state = 'agent') => {
  raw.prepare(`INSERT INTO wa_conversations (id, profile_name, last_message_at, created_at, state) VALUES (?, 'G', ?, ?, ?)`).run(phone, iso(lastWroteHoursAgo ?? 100), iso(100), state);
  if (lastWroteHoursAgo !== null) raw.prepare(`INSERT INTO wa_messages (wa_message_id, conversation_id, direction, kind, body, status, sent_at, created_at) VALUES (?, ?, 'in', 'text', 'hi', 'received', ?, ?)`).run(`in-${phone}`, phone, iso(lastWroteHoursAgo), iso(lastWroteHoursAgo));
};

// ---- the text
const text = pickupText(facts, 'pay_1')!;
assert.match(text, /^Hi Dzemal, here are the details for your Same-Day Taj Mahal Tour on Thu, 29 Oct 2026: pickup 7:30 AM, vehicle Innova CRYSTA, driver Sanjeev Kumar \(\+91 98710 33440\)\. Payment reference: pay_1$/);
assert.equal(pickupText({ ...facts, pickupTime: '', vehicle: '', driverName: '', driverPhone: '' }, 'p'), null, 'nothing filled in, nothing to send');

// ---- no country code
assert.match((await sendPickupDetails(env, db, '98765 43210', facts, 'p', 'owner')).error ?? '', /country code/);
assert.equal(calls.length, 0);

// ---- window open: a normal text, stored in the inbox
guest('491609525444', 2);
let r = await sendPickupDetails(env, db, '+49 160 9525444', facts, 'pay_1', 'owner');
assert.deepEqual([r.ok, r.via], [true, 'text']);
assert.equal(calls.length, 1);
assert.equal(calls[0].type, 'text');
assert.equal(calls[0].to, '491609525444');
assert.match(calls[0].text.body, /driver Sanjeev Kumar/);
const stored = raw.prepare(`SELECT kind, direction, body FROM wa_messages WHERE conversation_id = '491609525444' AND direction = 'out'`).all() as any[];
assert.equal(stored.length, 1, 'the message is in the backend inbox');
assert.equal(stored[0].kind, 'text');

// ---- window closed: the approved template with six parameters
guest('919876543210', 30);
r = await sendPickupDetails(env, db, '+91 98765 43210', facts, 'pay_2', 'owner');
assert.deepEqual([r.ok, r.via], [true, 'template']);
const tpl = calls[1];
assert.equal(tpl.type, 'template');
assert.equal(tpl.template.name, 'iwis_pickup_details');
const params = tpl.template.components[0].parameters.map((p: any) => p.text);
assert.deepEqual(params, ['Dzemal', 'Same-Day Taj Mahal Tour', 'Thu, 29 Oct 2026', '7:30 AM', 'Innova CRYSTA', 'Sanjeev Kumar +91 98710 33440']);
const tplStored = raw.prepare(`SELECT kind, body FROM wa_messages WHERE conversation_id = '919876543210' AND direction = 'out'`).all() as any[];
assert.equal(tplStored[0].kind, 'template');
assert.equal(tplStored[0].body, renderPickupTemplate(params));

// ---- one template per guest per 24 hours
const before = calls.length;
r = await sendPickupDetails(env, db, '+91 98765 43210', facts, 'pay_2', 'owner');
assert.equal(r.ok, false);
assert.match(r.error ?? '', /already sent/);
assert.equal(calls.length, before, 'nothing is sent twice');

// ---- a guest who never wrote at all gets the template, and a conversation is created
r = await sendPickupDetails(env, db, '+44 7700 900123', { ...facts, driverName: '', driverPhone: '' }, 'pay_3', 'owner');
assert.deepEqual([r.ok, r.via], [true, 'template']);
const p3 = calls[calls.length - 1].template.components[0].parameters.map((p: any) => p.text);
assert.equal(p3[5], 'to be confirmed', 'no driver yet is said plainly, never an empty parameter');
assert.ok(p3.every((x: string) => x.length > 0 && !/[\n\t]/.test(x)));
assert.ok(raw.prepare(`SELECT 1 FROM wa_conversations WHERE id = '447700900123'`).get());

// ---- opted out: nothing is sent
guest('33612345678', 1, 'opted_out');
const n0 = calls.length;
r = await sendPickupDetails(env, db, '+33 6 12 34 56 78', facts, 'pay_4', 'owner');
assert.equal(r.ok, false);
assert.match(r.error ?? '', /asked us to stop/);
assert.equal(calls.length, n0);

// ---- the template is not approved yet: staff are told why and what to do
refuse = { code: 132001, message: 'Template name does not exist in the translation' };
guest('4915112345678', 40);
r = await sendPickupDetails(env, db, '+49 151 1234 5678', facts, 'pay_5', 'owner');
assert.equal(r.ok, false);
assert.match(r.error ?? '', /iwis_pickup_details.*approved/);
assert.equal(raw.prepare(`SELECT COUNT(*) AS n FROM wa_messages WHERE conversation_id = '4915112345678' AND direction = 'out'`).get()!.n, 0, 'a refused send is not stored as sent');

// ---- WhatsApp not configured
refuse = null;
guest('353851234567', 40);
r = await sendPickupDetails({}, db, '+353 85 123 4567', facts, 'pay_6', 'owner');
assert.equal(r.ok, false);

// ---- parameters are cleaned
const messy = pickupTemplateParams({ ...facts, guestName: '  Ana\n  Maria ', tourTitle: 'A\tB', vehicle: '', pickupTime: '' });
assert.equal(messy[0], 'Ana');
assert.equal(messy[1], 'A B');
assert.equal(messy[3], 'to be confirmed');
assert.equal(messy[4], 'to be confirmed');
console.log('pickup send tests ok');
