// Checks the admin audit log (src/lib/audit.ts, schema_audit.sql): rows are written with the actor and address,
// are append-only (the database refuses UPDATE and DELETE), long text is cut, a missing table never throws, and
// paging and filtering work.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { auditActions, auditContext, listAudit, recordAudit } from '../../src/lib/audit';

const raw = new DatabaseSync(':memory:');
const mk = (r: DatabaseSync): any => ({
  prepare: (q: string) => ({ bind: (...v: unknown[]) => ({
    run: async () => ({ meta: { changes: Number(r.prepare(q).run(...(v as any)).changes) } }),
    first: async () => (r.prepare(q).get(...(v as any)) as any) ?? null,
    all: async () => ({ results: r.prepare(q).all(...(v as any)) as any[] }),
  }) }),
});
const db = mk(raw);

// A database without the table: recording must not throw or block the caller.
const errors: string[] = [];
const origError = console.error;
console.error = (...a: unknown[]) => { errors.push(a.join(' ')); };
assert.equal(await recordAudit(db, { actor: 'owner', ip: null }, { action: 'lead.export' }), false);
assert.equal(await recordAudit(undefined, { actor: 'owner', ip: null }, { action: 'lead.export' }), false);
console.error = origError;
assert.ok(errors.some((e) => e.includes('audit write failed') && e.includes('lead.export')), 'failure is logged');
await assert.rejects(() => listAudit(db), 'the viewer learns the table is missing');

raw.exec(readFileSync(`${process.env.ROOT}/schema_audit.sql`, 'utf8'));

const req = new Request('https://x.test/admin', { headers: { 'cf-connecting-ip': '203.0.113.9' } });
const ctx = auditContext(req);
assert.deepEqual(ctx, { actor: 'owner', ip: '203.0.113.9' });
assert.equal(auditContext(new Request('https://x.test/')).ip, null);

assert.equal(await recordAudit(db, ctx, { action: 'lead.export', resource: 'lead', summary: 'Exported all leads', meta: { rows: 23 } }), true);
assert.equal(await recordAudit(db, ctx, { action: 'campaign.send', resource: 'campaign', resourceId: 'cmp_1', summary: 'x'.repeat(1000), meta: { big: 'y'.repeat(5000) } }), true);
for (let i = 0; i < 5; i++) await recordAudit(db, ctx, { action: 'booking.status', resource: 'booking', resourceId: `b${i}`, summary: `Set status ${i}` });

const rows = await listAudit(db);
assert.equal(rows.length, 7);
assert.equal(rows[0].resource_id, 'b4', 'newest first');
const send = rows.find((r) => r.action === 'campaign.send')!;
assert.equal(send.summary!.length, 300);
assert.ok(send.summary!.endsWith('…'));
assert.ok(send.meta_json!.length <= 1000);
assert.equal(send.actor, 'owner');
assert.equal(send.ip, '203.0.113.9');
assert.match(send.at, /^\d{4}-\d{2}-\d{2}T/);

// Paging and filtering
assert.equal((await listAudit(db, { limit: 3 })).length, 3);
const page2 = await listAudit(db, { limit: 3, beforeId: rows[2].id });
assert.equal(page2[0].id, rows[3].id);
assert.deepEqual((await listAudit(db, { action: 'lead.export' })).map((r) => r.action), ['lead.export']);
assert.deepEqual(await auditActions(db), ['booking.status', 'campaign.send', 'lead.export']);

// Append-only: the database itself refuses changes and deletions.
assert.throws(() => raw.exec(`UPDATE admin_audit_log SET actor = 'someone else' WHERE id = 1`), /append-only/);
assert.throws(() => raw.exec(`DELETE FROM admin_audit_log WHERE id = 1`), /append-only/);
assert.throws(() => raw.exec(`DELETE FROM admin_audit_log`), /append-only/);
assert.equal((await listAudit(db)).length, 7, 'nothing was changed');

console.log('audit log tests ok');
