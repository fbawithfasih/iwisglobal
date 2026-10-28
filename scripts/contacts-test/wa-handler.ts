// Checks WhatsApp chat ownership (src/lib/waInbox.ts, schema_whatsapp_handler.sql): taking a chat, never overwriting someone,
// hand-over, clearing when the chat goes back to the agent, the Mine tab and counts, who sent each reply, and that
// recording who sent a message can never turn a sent message into an error.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import * as I from '../../src/lib/waInbox';
import { sendStaffMessage } from '../../src/lib/waDraft';

const SCHEMAS = ['schema_whatsapp.sql', 'schema_whatsapp_inbox.sql', 'schema_whatsapp_media.sql', 'schema_whatsapp_kb.sql', 'schema_whatsapp_auto.sql', 'schema_whatsapp_tools.sql', 'schema_whatsapp_learning.sql', 'schema_whatsapp_handler.sql'];
function build(files: string[]) {
  const raw = new DatabaseSync(':memory:');
  for (const f of files) for (const stmt of readFileSync(`${process.env.ROOT}/${f}`, 'utf8').replace(/^\s*--.*$/gm, '').split(';')) if (stmt.trim()) raw.exec(stmt.trim());
  const db: any = {
    prepare: (q: string) => ({ bind: (...v: unknown[]) => ({
      run: async () => ({ meta: { changes: Number(raw.prepare(q).run(...(v as any)).changes) } }),
      first: async () => (raw.prepare(q).get(...(v as any)) as any) ?? null,
      all: async () => ({ results: raw.prepare(q).all(...(v as any)) as any[] }),
    }) }),
  };
  return { raw, db };
}
const { raw, db } = build(SCHEMAS);
const asha = 'asha@example.com';
const ravi = 'ravi@example.com';
// Taken from the real clock: sendStaffMessage checks WhatsApp's 24-hour window against the real time, so a fixed date here would stop working a day later.
const NOW = new Date();
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const chat = (id: string, o: { state?: string; by?: string; lastIn?: number; name?: string } = {}) => {
  raw.prepare(`INSERT INTO wa_conversations (id, profile_name, state, last_message_at, created_at, handled_by) VALUES (?, ?, ?, ?, ?, ?)`).run(id, o.name ?? id, o.state ?? 'agent', ago(o.lastIn ?? 10), ago(500), o.by ?? '');
  if (o.lastIn !== undefined) raw.prepare(`INSERT INTO wa_messages (wa_message_id, conversation_id, direction, kind, body, status, sent_at, created_at) VALUES (?, ?, 'in', 'text', 'hi', 'received', ?, ?)`).run(`in-${id}`, id, ago(o.lastIn), ago(o.lastIn));
};
const row = (id: string) => ({ ...(raw.prepare(`SELECT state, handled_by, staff_active_at FROM wa_conversations WHERE id = ?`).get(id) as any) });

chat('c1', { lastIn: 50 });
chat('c2', { lastIn: 20 });
chat('c3', { state: 'handed_off', lastIn: 90 });
chat('c4', { state: 'opted_out', lastIn: 300 });

// ---- taking: first wins, nobody is overwritten, an opted-out guest cannot be taken
assert.deepEqual(await I.takeChat(db, 'c1', asha, NOW), { ok: true });
assert.deepEqual(row('c1'), { state: 'staff', handled_by: asha, staff_active_at: NOW.toISOString() }, 'taking pauses the agent and records who');
assert.deepEqual(await I.takeChat(db, 'c1', ravi, NOW), { ok: false, heldBy: asha });
assert.deepEqual(await I.takeChat(db, 'c1', asha, NOW), { ok: true }, 'taking your own chat again is harmless');
assert.equal(row('c1').handled_by, asha);
assert.deepEqual(await I.takeChat(db, 'c4', asha, NOW), { ok: false, reason: 'opted_out' });
assert.equal(row('c4').handled_by, '');
assert.deepEqual(await I.takeChat(db, 'nope', asha, NOW), { ok: false, reason: 'missing' });
assert.deepEqual(await I.takeChat(db, 'c3', ravi, NOW), { ok: true }, 'a chat waiting for a person can be taken');
assert.equal(row('c3').state, 'staff');

// ---- hand over: to a valid person, whoever holds it; not to nonsense; not an opted-out guest
assert.equal(await I.handOverChat(db, 'c1', 'Ravi@Example.com', NOW), true);
assert.equal(row('c1').handled_by, ravi);
assert.equal(await I.handOverChat(db, 'c1', ravi, NOW), false, 'no change');
assert.equal(await I.handOverChat(db, 'c1', 'owner', NOW), true);
assert.equal(await I.handOverChat(db, 'c1', '', NOW), false, 'use give back to clear it');
assert.equal(await I.handOverChat(db, 'c1', 'not an email', NOW), false);
assert.equal(await I.handOverChat(db, 'c4', asha, NOW), false);

// ---- the list: handled_by on rows, the Mine tab, counts
await I.handOverChat(db, 'c1', asha, NOW);
const all = await I.listInbox(db, 'all', NOW, asha);
assert.equal(all.find((r) => r.id === 'c1')!.handled_by, asha);
assert.equal(all.find((r) => r.id === 'c2')!.handled_by, '');
assert.deepEqual((await I.listInbox(db, 'mine', NOW, asha)).map((r) => r.id), ['c1']);
assert.deepEqual((await I.listInbox(db, 'mine', NOW, ravi)).map((r) => r.id), ['c3']);
assert.deepEqual(await I.listInbox(db, 'mine', NOW), [], 'no identity shows nothing rather than everything');
assert.deepEqual((await I.listInbox(db, 'staff', NOW, asha)).map((r) => r.id).sort(), ['c1', 'c3']);
const counts = await I.inboxCounts(db, asha);
assert.equal(counts.mine, 1);
assert.equal(counts.staff, 2);
assert.equal((await I.inboxCounts(db)).mine, 0);

// ---- the live-update fingerprint changes when a chat changes hands
const sig1 = await I.inboxSignature(db);
await I.handOverChat(db, 'c1', ravi, NOW);
assert.notEqual(await I.inboxSignature(db), sig1);

// ---- going back to the agent clears the holder, and so does an expired staff hold and a START after opting out
await I.giveBack(db, 'c1');
assert.deepEqual([row('c1').state, row('c1').handled_by], ['agent', '']);
await I.takeChat(db, 'c2', asha, NOW);
const later = new Date(NOW.getTime() + I.STAFF_HOLD_MS + 60_000);
const msg = (phone: string, body: string) => ({ waMessageId: `m-${phone}-${body}`, phone, direction: 'in' as const, kind: 'text' as const, body, profileName: null, sentAt: later.toISOString() });
assert.equal(await I.routeIncoming(db, msg('c2', 'hello again'), later), 'draft', 'the hold ran out, the agent drafts again');
assert.deepEqual([row('c2').state, row('c2').handled_by], ['agent', ''], 'and nobody holds it any more');
raw.prepare(`UPDATE wa_conversations SET handled_by = ? WHERE id = 'c4'`).run(ravi);
assert.equal(await I.routeIncoming(db, msg('c4', 'start'), later), 'skip');
assert.deepEqual([row('c4').state, row('c4').handled_by], ['agent', ''], 'START clears a stale holder');

// ---- who sent a message
raw.prepare(`INSERT INTO wa_messages (wa_message_id, conversation_id, direction, kind, body, status, sent_at, created_at) VALUES ('out-1', 'c2', 'out', 'text', 'ok', 'sent', ?, ?)`).run(ago(1), ago(1));
raw.prepare(`UPDATE wa_conversations SET state = 'staff' WHERE id = 'c2'`).run();
await I.attributeSend(db, 'c2', 'out-1', 'Asha@Example.com');
assert.equal((raw.prepare(`SELECT sent_by FROM wa_messages WHERE wa_message_id = 'out-1'`).get() as any).sent_by, asha);
assert.equal(row('c2').handled_by, asha, 'a person who replies to a staff chat nobody holds is now holding it');
await I.attributeSend(db, 'c2', 'out-1', ravi);
assert.equal(row('c2').handled_by, asha, 'a second person replying does not take it over');
await I.attributeSend(db, 'c2', 'out-1', '');
assert.equal((raw.prepare(`SELECT sent_by FROM wa_messages WHERE wa_message_id = 'out-1'`).get() as any).sent_by, ravi, 'no person given: nothing changes');
raw.prepare(`UPDATE wa_conversations SET state = 'agent', handled_by = '' WHERE id = 'c1'`).run();
raw.prepare(`INSERT INTO wa_messages (wa_message_id, conversation_id, direction, kind, body, status, sent_at, created_at) VALUES ('out-2', 'c1', 'out', 'text', 'ok', 'sent', ?, ?)`).run(ago(1), ago(1));
await I.attributeSend(db, 'c1', 'out-2', asha);
assert.equal(row('c1').handled_by, '', 'approving a draft in an agent chat does not make the person the holder');

// ---- sending a typed reply through the real function records the sender, with the WhatsApp call stubbed
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.SENT1' }] }), { status: 200 })) as any;
const env = { WHATSAPP_ACCESS_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: '1' };
chat('c5', { lastIn: 5 });
assert.deepEqual(await sendStaffMessage(env, db, 'c5', 'Hello, how can I help?', asha), { ok: true });
assert.equal((raw.prepare(`SELECT sent_by FROM wa_messages WHERE wa_message_id = 'wamid.SENT1'`).get() as any).sent_by, asha);
assert.deepEqual([row('c5').state, row('c5').handled_by], ['staff', asha], 'a typed reply takes the chat');

// ---- before the new columns exist, a send must still succeed (attribution is best effort)
const old = build(SCHEMAS.filter((f) => f !== 'schema_whatsapp_handler.sql'));
old.raw.prepare(`INSERT INTO wa_conversations (id, profile_name, state, last_message_at, created_at) VALUES ('o1', 'o1', 'agent', ?, ?)`).run(ago(5), ago(5));
old.raw.prepare(`INSERT INTO wa_messages (wa_message_id, conversation_id, direction, kind, body, status, sent_at, created_at) VALUES ('in-o1', 'o1', 'in', 'text', 'hi', 'received', ?, ?)`).run(ago(5), ago(5));
globalThis.fetch = (async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.OLD' }] }), { status: 200 })) as any;
const quiet = console.error;
const logged: string[] = [];
console.error = (...a: unknown[]) => { logged.push(a.join(' ')); };
assert.deepEqual(await sendStaffMessage(env, old.db, 'o1', 'hi there', asha), { ok: true }, 'the message was sent, so it reports success');
console.error = quiet;
assert.ok(logged.some((l) => l.includes('could not record who sent')), 'and the problem is logged');
globalThis.fetch = realFetch;

console.log('whatsapp chat ownership tests ok');
