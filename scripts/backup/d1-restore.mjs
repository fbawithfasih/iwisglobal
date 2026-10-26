#!/usr/bin/env node
// Restores a backup written by d1-backup.mjs into an EMPTY database: tables and rows, then every index from the
// repo's schema files, then the triggers (audit log append-only rules), then the WhatsApp search index. It never targets the production database.
//
//   node scripts/backup/d1-restore.mjs --file backup.sql --local [--cwd <dir>]
//   node scripts/backup/d1-restore.mjs --file backup.sql --remote --db iwisglobal-restore-test
//
// To rehearse safely: restore into a new database (`npx wrangler d1 create iwisglobal-restore-test`) or --local.
// To undo a bad change to production, use D1 Time Travel instead (see docs/platform/IWIS_BACKUP_AND_RECOVERY.md).
//
// Skipping the index step leaves a database with no indexes and no unique protection (a rehearsal showed a
// duplicate row being accepted), so this script always runs it.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FTS_REBUILD_SQL, PRODUCTION_DB, indexStatements, rowsFromExecuteJson, triggerStatements } from './lib.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

const file = value('--file');
const remote = flag('--remote');
const local = flag('--local');
const cwd = value('--cwd');
const db = value('--db') ?? (local ? PRODUCTION_DB : undefined);
if (!file || remote === local || !db) {
  console.error('Usage: node scripts/backup/d1-restore.mjs --file <backup.sql> (--local [--cwd <dir>] | --remote --db <new-database-name>)');
  process.exit(2);
}
if (remote && db === PRODUCTION_DB) {
  console.error(`Refusing to restore into the production database "${PRODUCTION_DB}". Restore into a new database, or use D1 Time Travel.`);
  process.exit(2);
}

const where = remote ? ['--remote'] : ['--local'];
const base = cwd ? ['--cwd', resolve(cwd)] : [];
const run = (extra) => execFileSync('npx', ['wrangler', 'd1', 'execute', db, ...where, ...base, ...extra], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

const existing = rowsFromExecuteJson(run(['--json', '--command', "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'"]));
if (existing.length > 0) {
  console.error(`The target database already has ${existing.length} tables. Restore only into an empty database.`);
  process.exit(2);
}

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const schemaTexts = readdirSync(root).filter((f) => /^schema.*\.sql$/.test(f)).sort().map((f) => readFileSync(join(root, f), 'utf8'));
const indexes = indexStatements(schemaTexts);
const triggers = triggerStatements(schemaTexts);
const work = mkdtempSync(join(tmpdir(), 'iwis-restore-'));
writeFileSync(join(work, 'indexes.sql'), indexes.join('\n') + '\n');
writeFileSync(join(work, 'triggers.sql'), triggers.join('\n') + '\n');
writeFileSync(join(work, 'fts.sql'), FTS_REBUILD_SQL);

console.log(`1/3 Restoring tables and rows from ${file} into "${db}" (${remote ? 'remote' : 'local'}) ...`);
run(['--file', resolve(file)]);
console.log(`2/3 Re-creating ${indexes.length} indexes from the schema files ...`);
run(['--file', join(work, 'indexes.sql')]);
console.log(`2b/3 Re-creating ${triggers.length} trigger(s) (the audit log's append-only rules) ...`);
if (triggers.length > 0) run(['--file', join(work, 'triggers.sql')]);
console.log('3/3 Rebuilding the WhatsApp knowledge-base search index ...');
run(['--file', join(work, 'fts.sql')]);

const tables = rowsFromExecuteJson(run(['--json', '--command', "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'"]))[0]?.n;
const found = rowsFromExecuteJson(run(['--json', '--command', "SELECT count(*) AS n FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'"]))[0]?.n;
console.log(`Done: ${tables} tables (including the search index tables) and ${found} indexes in "${db}".`);
if (found < indexes.length) {
  console.error(`Expected at least ${indexes.length} indexes but found ${found}.`);
  process.exit(1);
}
