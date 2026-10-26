// Pure helpers for the D1 backup and restore scripts (no I/O, so they can be tested).
//
// Why these exist (found by rehearsing a restore on a local copy, 26 Oct 2026; see docs/platform/IWIS_BACKUP_AND_RECOVERY.md):
//   1. `wrangler d1 export` refuses any database that has an FTS5 virtual table ("cannot export databases with
//      Virtual Tables (fts5)"). This database has one, wa_kb_fts. Naming only the other tables with --table works.
//   2. The export file contains no CREATE INDEX statements, so a restore from it has no indexes and no unique
//      protection. The schema files in the repo reproduce every production index exactly, so they are the source.
//   3. The search index is derived data: it is rebuilt from the approved WhatsApp knowledge-base entries.

export const PRODUCTION_DB = 'iwisglobal-bookings';

/**
 * Splits the tables of a database into those `wrangler d1 export` can write and those it cannot.
 * @param {{ name: string, sql?: string | null }[]} rows rows of sqlite_master where type = 'table'
 */
export function exportableTables(rows) {
  const tables = rows.filter((r) => r.name && !r.name.startsWith('sqlite_') && !r.name.startsWith('_cf_'));
  const virtual = tables.filter((r) => /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(r.sql ?? '')).map((r) => r.name);
  // An FTS5 table keeps its data in shadow tables named <table>_data, _idx, _content, _docsize and _config.
  const isShadow = (name) => virtual.some((v) => name.startsWith(`${v}_`));
  const keep = tables.filter((r) => !virtual.includes(r.name) && !isShadow(r.name)).map((r) => r.name).sort();
  const excluded = tables.filter((r) => virtual.includes(r.name) || isShadow(r.name)).map((r) => r.name).sort();
  return { keep, excluded, virtual };
}

/**
 * Every CREATE INDEX statement in the repo's schema files, each made idempotent (IF NOT EXISTS).
 * @param {string[]} schemaTexts contents of schema*.sql
 */
export function indexStatements(schemaTexts) {
  const out = [];
  const seen = new Set();
  for (const text of schemaTexts) {
    const noComments = text.replace(/--[^\n]*/g, '');
    for (const m of noComments.matchAll(/CREATE\s+(UNIQUE\s+)?INDEX\s+(IF\s+NOT\s+EXISTS\s+)?([^;]*);/gis)) {
      const body = m[3].trim();
      const name = /^"?(\w+)"?/.exec(body)?.[1];
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push(`CREATE ${m[1] ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${body};`);
    }
  }
  return out;
}

/**
 * Every CREATE TRIGGER statement in the schema files, made idempotent. Like indexes, triggers are not in an export file.
 * @param {string[]} schemaTexts contents of schema*.sql
 */
export function triggerStatements(schemaTexts) {
  const out = [];
  const seen = new Set();
  for (const text of schemaTexts) {
    const noComments = text.replace(/--[^\n]*/g, '');
    for (const m of noComments.matchAll(/CREATE\s+TRIGGER\s+(IF\s+NOT\s+EXISTS\s+)?([\s\S]*?\bEND\s*;)/gi)) {
      const name = /^"?(\w+)"?/.exec(m[2].trim())?.[1];
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push(`CREATE TRIGGER IF NOT EXISTS ${m[2].trim()}`);
    }
  }
  return out;
}

/** Recreates the WhatsApp knowledge-base search index from the approved entries (mirrors syncIndex in src/lib/waKnowledge.ts). */
export const FTS_REBUILD_SQL = [
  "CREATE VIRTUAL TABLE IF NOT EXISTS wa_kb_fts USING fts5(text, entry_id UNINDEXED, tokenize = 'porter unicode61');",
  'DELETE FROM wa_kb_fts;',
  "INSERT INTO wa_kb_fts (text, entry_id) SELECT question || ' ' || answer, id FROM wa_kb_entries WHERE status = 'approved';",
  '',
].join('\n');

/** Parses `wrangler d1 execute --json` output into rows. */
export function rowsFromExecuteJson(stdout) {
  const start = stdout.indexOf('[');
  const parsed = JSON.parse(stdout.slice(start));
  return (parsed[0]?.results ?? []);
}
