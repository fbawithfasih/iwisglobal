// Checks the pure helpers behind the D1 backup and restore scripts (scripts/backup/lib.mjs), and that the
// index statements derived from the repo's schema files cover every CREATE INDEX in them.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FTS_REBUILD_SQL, PRODUCTION_DB, exportableTables, indexStatements, rowsFromExecuteJson } from '../backup/lib.mjs';

assert.equal(PRODUCTION_DB, 'iwisglobal-bookings');

// Which tables can be exported: the FTS5 table and its five shadow tables cannot.
const rows = [
  { name: 'bookings', sql: 'CREATE TABLE bookings (id TEXT)' },
  { name: 'wa_kb_entries', sql: 'CREATE TABLE wa_kb_entries (id INTEGER)' },
  { name: 'wa_kb_fts', sql: "CREATE VIRTUAL TABLE wa_kb_fts USING fts5(text, entry_id UNINDEXED, tokenize = 'porter unicode61')" },
  ...['data', 'idx', 'content', 'docsize', 'config'].map((s) => ({ name: `wa_kb_fts_${s}`, sql: `CREATE TABLE 'wa_kb_fts_${s}'(id)` })),
  { name: 'sqlite_sequence', sql: 'CREATE TABLE sqlite_sequence(name,seq)' },
  { name: '_cf_KV', sql: 'CREATE TABLE _cf_KV (key TEXT)' },
  { name: 'wa_messages', sql: null },
];
const t = exportableTables(rows);
assert.deepEqual(t.keep, ['bookings', 'wa_kb_entries', 'wa_messages']);
assert.deepEqual(t.virtual, ['wa_kb_fts']);
assert.equal(t.excluded.length, 6);
assert.ok(!t.keep.includes('sqlite_sequence') && !t.keep.includes('_cf_KV'));
// A real table that merely starts with the same letters as the virtual one is kept.
assert.deepEqual(exportableTables([{ name: 'wa_kb_fts', sql: 'CREATE VIRTUAL TABLE wa_kb_fts USING fts5(text)' }, { name: 'wa_kb_ftsx', sql: 'CREATE TABLE wa_kb_ftsx (a)' }]).keep, ['wa_kb_ftsx']);

// Index statements: comments ignored, IF NOT EXISTS added, UNIQUE and partial indexes kept, duplicates dropped.
const idx = indexStatements([
  `-- CREATE INDEX idx_in_comment ON x (a);
   CREATE INDEX idx_a ON t (a);
   CREATE UNIQUE INDEX IF NOT EXISTS idx_b ON t (b) WHERE c = 0;
   create index idx_a on t (a);`,
]);
assert.deepEqual(idx, ['CREATE INDEX IF NOT EXISTS idx_a ON t (a);', 'CREATE UNIQUE INDEX IF NOT EXISTS idx_b ON t (b) WHERE c = 0;']);

// Against the real schema files: every CREATE INDEX name is found, and each statement is well formed.
const root = new URL('../..', import.meta.url).pathname;
const texts = readdirSync(root).filter((f) => /^schema.*\.sql$/.test(f)).sort().map((f) => readFileSync(join(root, f), 'utf8'));
const all = indexStatements(texts);
const expected = new Set(texts.flatMap((x) => [...x.replace(/--[^\n]*/g, '').matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi)].map((m) => m[1])));
assert.equal(all.length, expected.size, 'one statement per distinct index name');
assert.ok(all.length >= 51, `production has 51 indexes, schema files give ${all.length}`);
for (const s of all) assert.match(s, /^CREATE (UNIQUE )?INDEX IF NOT EXISTS \w+ ON \w+/);
assert.ok(all.some((s) => /UNIQUE INDEX IF NOT EXISTS idx_identifiers_unique/.test(s) && /WHERE/i.test(s)), 'the partial unique index on person identifiers is included');

assert.match(FTS_REBUILD_SQL, /CREATE VIRTUAL TABLE IF NOT EXISTS wa_kb_fts USING fts5/);
assert.match(FTS_REBUILD_SQL, /WHERE status = 'approved'/);

// wrangler prints banner text before the JSON.
assert.deepEqual(rowsFromExecuteJson(' ⛅️ wrangler 4\n[{"results":[{"n":3}],"success":true}]'), [{ n: 3 }]);
assert.deepEqual(rowsFromExecuteJson('[{"results":[],"success":true}]'), []);

console.log('backup tools tests ok');
