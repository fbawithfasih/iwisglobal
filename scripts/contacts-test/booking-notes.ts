// Booking notes keep their author (schema_booking_note_author.sql); older notes read as unknown.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { addBookingNote, listBookingNotes } from '../../src/lib/crm';
import { ownerLabel } from '../../src/lib/leadsAdmin';

const raw = new DatabaseSync(':memory:');
const load = (f: string) => { for (const stmt of readFileSync(`${process.env.ROOT}/${f}`, 'utf8').replace(/^\s*--.*$/gm, '').split(';')) if (stmt.trim()) raw.exec(stmt.trim()); };
load('schema.sql');
load('schema_crm.sql');
// A note written before the column existed.
raw.prepare(`INSERT INTO booking_notes (id, booking_id, note, created_at) VALUES ('old', 'bk1', 'old note', '2026-10-01T00:00:00Z')`).run();
load('schema_booking_note_author.sql');
const db: any = {
  prepare: (q: string) => ({ bind: (...v: unknown[]) => ({
    run: async () => ({ meta: { changes: Number(raw.prepare(q).run(...(v as any)).changes) } }),
    first: async () => (raw.prepare(q).get(...(v as any)) as any) ?? null,
    all: async () => ({ results: raw.prepare(q).all(...(v as any)) as any[] }),
  }) }),
};

await addBookingNote(db, 'bk1', 'pickup moved to 7am', 'asha@example.com');
await addBookingNote(db, 'bk1', 'guest paid balance', 'owner');
await addBookingNote(db, 'bk1', 'no author given');
await addBookingNote(db, 'bk2', 'other booking', 'ravi@example.com');
const notes = await listBookingNotes(db, 'bk1');
assert.equal(notes.length, 4);
const by = (text: string) => notes.find((n) => n.note === text)!.author;
assert.equal(by('old note'), '', 'older notes have no known author');
assert.equal(by('pickup moved to 7am'), 'asha@example.com');
assert.equal(by('guest paid balance'), 'owner');
assert.equal(by('no author given'), '');
assert.ok(notes.every((n) => n.booking_id === 'bk1'));
const names = { 'asha@example.com': 'Asha' };
assert.equal(ownerLabel('asha@example.com', names), 'Asha');
assert.equal(ownerLabel('owner', names), 'Owner');
console.log('booking notes tests ok');
