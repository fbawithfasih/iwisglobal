// Balance and review messages go through the WhatsApp Business API when the guest wrote in the last 24 hours (src/lib/waDirect.ts),
// are refused with windowClosed otherwise, never go to a guest who opted out, and the plain WhatsApp buttons find the inbox chat.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { sendWithinWindow, chatLinks, chatLink } from '../../src/lib/waDirect';

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
globalThis.fetch = (async (_url: any, init: any) => {
  calls.push(JSON.parse(init.body));
  return new Response(JSON.stringify({ messages: [{ id: `wamid.${calls.length}` }] }), { status: 200 });
}) as any;
const env = { WHATSAPP_ACCESS_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: '123' };

const NOW = Date.now();
const iso = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const guest = (phone: string, wroteHoursAgo: number | null, state = 'agent') => {
  raw.prepare(`INSERT INTO wa_conversations (id, profile_name, last_message_at, created_at, state) VALUES (?, 'G', ?, ?, ?)`).run(phone, iso(wroteHoursAgo ?? 100), iso(100), state);
  if (wroteHoursAgo !== null) raw.prepare(`INSERT INTO wa_messages (wa_message_id, conversation_id, direction, kind, body, status, sent_at, created_at) VALUES (?, ?, 'in', 'text', 'hi', 'received', ?, ?)`).run(`in-${phone}`, phone, iso(wroteHoursAgo), iso(wroteHoursAgo));
};

// No country code: refused before anything else.
assert.match((await sendWithinWindow(env, db, '98765 43210', 'hello', 'owner')).error ?? '', /country code/);

// Window open: sent as a normal text and kept in the inbox.
guest('491609525444', 2);
let r = await sendWithinWindow(env, db, '+49 160 9525444', 'Hi, your balance link: https://x', 'owner');
assert.equal(r.ok, true);
assert.equal(calls.length, 1);
assert.deepEqual([calls[0].type, calls[0].to], ['text', '491609525444']);
assert.equal((raw.prepare(`SELECT COUNT(*) AS n FROM wa_messages WHERE conversation_id = '491609525444' AND direction = 'out'`).get() as any).n, 1);

// Window closed: refused, nothing sent, and the caller is told so it can offer the phone app.
guest('919876543210', 30);
r = await sendWithinWindow(env, db, '+91 98765 43210', 'hello', 'owner');
assert.deepEqual([r.ok, r.windowClosed], [false, true]);
assert.equal(calls.length, 1, 'nothing went out');

// A guest who never wrote, and one with no chat at all: also closed.
guest('447700900123', null);
assert.equal((await sendWithinWindow(env, db, '+44 7700 900123', 'hello', 'owner')).windowClosed, true);
assert.equal((await sendWithinWindow(env, db, '+33 6 12 34 56 78', 'hello', 'owner')).windowClosed, true);

// Opted out: never sent, and not reported as a closed window.
guest('4915112345678', 1, 'opted_out');
r = await sendWithinWindow(env, db, '+49 151 12345678', 'hello', 'owner');
assert.deepEqual([r.ok, r.windowClosed ?? false], [false, false]);
assert.match(r.error ?? '', /stop/);
assert.equal(calls.length, 1);

// Inbox links: only phones that have a chat; numbers are matched the way the inbox stores them.
const links = await chatLinks(db, ['+49 160 9525444', '+91 98765 43210', '+1 202 555 0100', '', null, '98765 43210']);
assert.equal(links.get('491609525444'), '/admin/whatsapp?c=491609525444');
assert.equal(links.get('919876543210'), '/admin/whatsapp?c=919876543210');
assert.equal(links.has('12025550100'), false, 'no chat, no link');
assert.equal(links.size, 2);
assert.equal(await chatLink(db, '+49 160 9525444'), '/admin/whatsapp?c=491609525444');
assert.equal(await chatLink(db, '+1 202 555 0100'), null);
assert.equal(await chatLink(db, null), null);
assert.equal((await chatLinks(db, [])).size, 0);
console.log('wa-direct tests ok');
