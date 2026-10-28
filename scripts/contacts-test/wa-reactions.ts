// A reaction (or a guest editing or deleting an earlier message) needs no answer: it must not make a chat "waiting" in the
// inbox, on Today or in the bell. A real message still does.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { listInbox } from '../../src/lib/waInbox';
import { silentMessageSql, isSilentMessage } from '../../src/lib/whatsapp';

const raw = new DatabaseSync(':memory:');
for (const f of ['schema_whatsapp.sql', 'schema_whatsapp_inbox.sql', 'schema_whatsapp_media.sql', 'schema_whatsapp_handler.sql']) {
  for (const stmt of readFileSync(`${process.env.ROOT}/${f}`, 'utf8').replace(/^\s*--.*$/gm, '').split(';')) if (stmt.trim()) raw.exec(stmt.trim());
}
const db: any = { prepare: (q: string) => ({ bind: (...v: unknown[]) => ({
  run: async () => ({ meta: { changes: Number(raw.prepare(q).run(...(v as any)).changes) } }),
  first: async () => (raw.prepare(q).get(...(v as any)) as any) ?? null,
  all: async () => ({ results: raw.prepare(q).all(...(v as any)) as any[] }),
}) }) };

const NOW = new Date('2026-10-28T10:00:00.000Z');
const at = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
let n = 0;
const chat = (id: string) => raw.prepare(`INSERT INTO wa_conversations (id, profile_name, last_message_at, created_at) VALUES (?, 'G', ?, ?)`).run(id, at(0), at(600));
const msg = (conv: string, dir: 'in' | 'out', kind: string, minAgo: number, meta: unknown = null) =>
  raw.prepare(`INSERT INTO wa_messages (wa_message_id, conversation_id, direction, kind, body, status, sent_at, created_at, meta_json) VALUES (?, ?, ?, ?, ?, 'x', ?, ?, ?)`)
    .run(`m${++n}`, conv, dir, kind, kind === 'reaction' ? '[reaction 👍]' : 'text', at(minAgo), at(minAgo), meta ? JSON.stringify(meta) : null);
const row = async (id: string) => (await listInbox(db, 'all', NOW)).find((r) => r.id === id)!;

// The exact case: guest wrote, the owner replied, the guest reacted with a thumbs up. Nothing to answer.
chat('c1'); msg('c1', 'in', 'text', 60); msg('c1', 'out', 'text', 55); msg('c1', 'in', 'reaction', 52, { emoji: '👍' });
let r = await row('c1');
assert.equal(r.waiting, false, 'a thumbs-up after our reply does not make the chat waiting');
assert.equal(r.waitingMs, 0);
assert.ok(r.windowLeftMs !== null, 'the reply window is still worked out from the guest\'s last activity');

// A real message after the reaction does.
msg('c1', 'in', 'text', 10);
r = await row('c1');
assert.equal(r.waiting, true);
assert.equal(r.waitingMs, 10 * 60_000, 'waiting time runs from the real message, not the reaction');

// A reaction is not counted even when it is the only thing since our reply, however many.
chat('c2'); msg('c2', 'in', 'text', 90); msg('c2', 'out', 'text', 80); msg('c2', 'in', 'reaction', 30, { emoji: '❤️' }); msg('c2', 'in', 'reaction', 20, { emoji: '' });
assert.equal((await row('c2')).waiting, false);

// A guest who only ever reacted (never wrote) is not waiting.
chat('c3'); msg('c3', 'in', 'reaction', 5, { emoji: '👍' });
assert.equal((await row('c3')).waiting, false);

// An edit or a deletion of an earlier message needs no answer; a poll or an album does.
chat('c4'); msg('c4', 'in', 'text', 90); msg('c4', 'out', 'text', 80); msg('c4', 'in', 'unsupported', 15, { unsupportedType: 'edit' });
assert.equal((await row('c4')).waiting, false, 'an edit is not a new question');
chat('c5'); msg('c5', 'in', 'text', 90); msg('c5', 'out', 'text', 80); msg('c5', 'in', 'unsupported', 15, { unsupportedType: 'revoke' });
assert.equal((await row('c5')).waiting, false, 'a deletion is not a new question');
chat('c6'); msg('c6', 'in', 'text', 90); msg('c6', 'out', 'text', 80); msg('c6', 'in', 'unsupported', 15, { unsupportedType: 'album' });
assert.equal((await row('c6')).waiting, true, 'an album is something the guest sent and we cannot read: a person must look');

// Photos and voice notes still count.
chat('c7'); msg('c7', 'in', 'image', 12);
assert.equal((await row('c7')).waiting, true);

// The SQL rule and the JavaScript rule agree.
for (const [kind, meta, silent] of [['reaction', null, true], ['text', null, false], ['image', null, false], ['unsupported', { unsupportedType: 'edited' }, true], ['unsupported', { unsupportedType: 'Deleted' }, true], ['unsupported', { unsupportedType: 'poll' }, false], ['unsupported', null, false]] as const) {
  raw.prepare(`INSERT INTO wa_messages (wa_message_id, conversation_id, direction, kind, body, status, sent_at, created_at, meta_json) VALUES (?, 'cx', 'in', ?, '', 'x', ?, ?, ?)`).run(`s${++n}`, kind, at(1), at(1), meta ? JSON.stringify(meta) : null);
  const sql = raw.prepare(`SELECT ${silentMessageSql('m')} AS s FROM wa_messages m WHERE wa_message_id = ?`).get(`s${n}`) as any;
  assert.equal(!!sql.s, silent, `${kind} ${JSON.stringify(meta)} (SQL)`);
  assert.equal(isSilentMessage({ kind: kind as any, meta: (meta ?? undefined) as any }), silent, `${kind} ${JSON.stringify(meta)} (JS)`);
}
console.log('whatsapp reaction tests ok');
