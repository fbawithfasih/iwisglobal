// Checks the pictures on the admin WhatsApp page (src/lib/waInsights.ts): messages per India day, wait buckets, reply windows.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { messageFlow, waitBuckets, windowBuckets, FLOW_DAYS } from '../../src/lib/waInsights';

const raw = new DatabaseSync(':memory:');
for (const f of ['schema_whatsapp.sql', 'schema_whatsapp_inbox.sql', 'schema_whatsapp_media.sql', 'schema_whatsapp_handler.sql']) {
  for (const stmt of readFileSync(`${process.env.ROOT}/${f}`, 'utf8').replace(/^\s*--.*$/gm, '').split(';')) if (stmt.trim()) raw.exec(stmt.trim());
}
const db: any = {
  prepare: (q: string) => ({ bind: (...v: unknown[]) => ({
    run: async () => ({ meta: { changes: Number(raw.prepare(q).run(...(v as any)).changes) } }),
    first: async () => (raw.prepare(q).get(...(v as any)) as any) ?? null,
    all: async () => ({ results: raw.prepare(q).all(...(v as any)) as any[] }),
  }) }),
};
raw.prepare(`INSERT INTO wa_conversations (id, profile_name, last_message_at, created_at, state) VALUES ('9190', 'G', '2026-10-27T00:00:00Z', '2026-10-01T00:00:00Z', 'agent')`).run();
let n = 0;
const msg = (sentAt: string, direction: string, kind = 'text', meta: string | null = null) => {
  n++;
  raw.prepare(`INSERT INTO wa_messages (wa_message_id, conversation_id, direction, kind, body, status, sent_at, created_at, meta_json) VALUES (?, '9190', ?, ?, 'x', 'received', ?, ?, ?)`).run(`w${n}`, direction, kind, sentAt, sentAt, meta);
};
const TODAY = '2026-10-27';
msg('2026-10-27T03:00:00.000Z', 'in');
msg('2026-10-26T19:00:00.000Z', 'in');                       // 00:30 on the 27th in India
msg('2026-10-26T18:00:00.000Z', 'in');                       // 23:30 on the 26th in India
msg('2026-10-27T04:00:00.000Z', 'out');
msg('2026-10-27T05:00:00.000Z', 'echo');                     // sent from the phone app: ours
msg('2026-10-27T06:00:00.000Z', 'in', 'reaction');           // a reaction is not a message to answer
msg('2026-10-27T06:30:00.000Z', 'in', 'unsupported', JSON.stringify({ unsupportedType: 'edit' }));   // an edit: not either
msg('2026-10-27T07:00:00.000Z', 'in', 'unsupported', JSON.stringify({ unsupportedType: 'poll' }));   // a poll the agent cannot read: counts
msg('2026-09-01T00:00:00.000Z', 'in');                       // before the window

const f = await messageFlow(db, TODAY);
assert.equal(f.length, FLOW_DAYS);
assert.equal(f[0].day, '2026-10-14');
assert.equal(f.at(-1)!.day, TODAY);
const day = (d: string) => f.find((x) => x.day === d)!;
assert.deepEqual([day(TODAY).guest, day(TODAY).ours], [3, 2], 'India day; the reaction and the edit are left out, the poll counts');
assert.deepEqual([day('2026-10-26').guest, day('2026-10-26').ours], [1, 0]);
assert.equal(f.reduce((t, d) => t + d.guest + d.ours, 0), 6, 'nothing outside the window');

const row = (o: Partial<{ waiting: boolean; waitingMs: number; windowLeftMs: number | null; state: any }>) => ({ waiting: false, waitingMs: 0, windowLeftMs: null, state: 'agent', ...o });
const H = 3_600_000;
assert.deepEqual(waitBuckets([row({ waiting: true, waitingMs: 10 * 60_000 }), row({ waiting: true, waitingMs: 2 * H }), row({ waiting: true, waitingMs: 4 * H }), row({ waiting: true, waitingMs: 50 * H }), row({ waiting: false, waitingMs: 99 * H }), row({ waiting: true, waitingMs: 9 * H, state: 'opted_out' })]), { calm: 1, soon: 1, late: 2 });
assert.deepEqual(waitBuckets([]), { calm: 0, soon: 0, late: 0 });
assert.deepEqual(windowBuckets([row({ windowLeftMs: 20 * H }), row({ windowLeftMs: 2 * H }), row({ windowLeftMs: 2 * H - 1 }), row({ windowLeftMs: 0 }), row({ windowLeftMs: -5 * H }), row({ windowLeftMs: null }), row({ windowLeftMs: 5 * H, state: 'opted_out' })]), { plenty: 2, closing: 1, closed: 2 });
console.log('wa insights tests ok');
