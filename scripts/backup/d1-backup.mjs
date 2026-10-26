#!/usr/bin/env node
// Writes a SQL backup of the D1 database that `wrangler d1 export` can read, plus a small manifest.
//
//   node scripts/backup/d1-backup.mjs --remote --output backups/iwis-2026-10-26.sql
//   node scripts/backup/d1-backup.mjs --local [--cwd <dir>] --output backup.sql
//
// --remote reads the production database and needs `wrangler login` (or CLOUDFLARE_API_TOKEN) on this computer.
// It only reads. The file holds customer data (names, emails, phone numbers, WhatsApp messages): keep it private,
// never commit it, never attach it to a pull request.
//
// The FTS5 search tables are left out because Cloudflare's export refuses databases that contain them; the restore
// script rebuilds them. See docs/platform/IWIS_BACKUP_AND_RECOVERY.md.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PRODUCTION_DB, exportableTables, rowsFromExecuteJson } from './lib.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

const remote = flag('--remote');
const local = flag('--local');
const output = value('--output');
const cwd = value('--cwd');
const db = value('--db') ?? PRODUCTION_DB;
if (remote === local || !output) {
  console.error('Usage: node scripts/backup/d1-backup.mjs (--remote | --local [--cwd <dir>]) --output <file.sql> [--db <name>]');
  process.exit(2);
}

const where = remote ? ['--remote'] : ['--local'];
const base = cwd ? ['--cwd', resolve(cwd)] : [];
const wrangler = (sub, extra) => execFileSync('npx', ['wrangler', ...sub, ...where, ...base, ...extra], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

console.log(`Reading the table list from ${remote ? 'the REMOTE' : 'the local'} database "${db}" ...`);
const listing = wrangler(['d1', 'execute', db], ['--json', '--command', "SELECT name, sql FROM sqlite_master WHERE type = 'table'"]);
const { keep, excluded } = exportableTables(rowsFromExecuteJson(listing));
if (keep.length === 0) throw new Error('No tables found; refusing to write an empty backup.');
console.log(`${keep.length} tables to export; left out (rebuilt on restore): ${excluded.join(', ') || 'none'}`);

mkdirSync(dirname(resolve(output)), { recursive: true });
wrangler(['d1', 'export', db], [...keep.flatMap((t) => ['--table', t]), '--output', resolve(output)]);

const sql = readFileSync(resolve(output));
const createCount = (sql.toString().match(/^CREATE TABLE/gm) ?? []).length;
const insertCount = (sql.toString().match(/^INSERT INTO/gm) ?? []).length;
if (createCount !== keep.length) throw new Error(`Backup has ${createCount} CREATE TABLE statements but ${keep.length} tables were requested; do not rely on this file.`);

const manifest = {
  createdAt: new Date().toISOString(),
  database: db,
  source: remote ? 'remote' : 'local',
  tables: keep,
  leftOut: excluded,
  createTableStatements: createCount,
  insertStatements: insertCount,
  bytes: sql.length,
  sha256: createHash('sha256').update(sql).digest('hex'),
};
writeFileSync(`${resolve(output)}.manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Wrote ${output} (${sql.length} bytes, ${createCount} tables, ${insertCount} rows) and ${output}.manifest.json`);
