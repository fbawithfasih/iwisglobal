# IWIS Global: backup and recovery

Status: written 26 Oct 2026 (milestone M0). Parts marked **[Rehearsed]** were run end to end on a local copy that has exactly the production structure (64 tables, 51 indexes). Parts marked **[Not rehearsed]** need a Cloudflare login that the build environment does not have; run them once yourself and tell me what you see.

## What is stored where

| Data | Where | Backed up by |
|---|---|---|
| Bookings, customers, leads, WhatsApp chats, blog posts, offers, consent records | Cloudflare D1 database `iwisglobal-bookings` | D1 Time Travel (automatic) plus the export tool below |
| Images (blog, tours) | R2 bucket `iwisglobal-images` | Nothing automatic. See "R2" below |
| Code and schema files | GitHub `fbawithfasih/iwisglobal` | Git history |
| Secrets (API keys, tokens) | Cloudflare Pages settings | Not in git by design. Keep a copy in your password manager |

## Which tool for which problem

| Problem | Use | Time |
|---|---|---|
| A bad change or accidental delete in the last days | **Time Travel** restore of the production database to a moment before it | Minutes |
| Need a copy of the data outside Cloudflare (monthly safety copy, moving, a rehearsal) | **Export tool** `scripts/backup/d1-backup.mjs` | Minutes |
| Need to prove a backup works | **Restore tool** `scripts/backup/d1-restore.mjs` into a throwaway database | Minutes |
| Lost image files | R2 copy (if you made one) | Depends |

## 1. Time Travel (point-in-time recovery) **[Not rehearsed]**

D1 keeps a history automatically: 30 days on the Workers Paid plan, 7 days on Free. Nothing to switch on. Restoring rewinds the whole database in place, including data written after that moment, so use it deliberately.

```
npx wrangler login                                          # once, opens a browser
npx wrangler d1 time-travel info iwisglobal-bookings        # shows the current bookmark and the earliest restorable time
npx wrangler d1 time-travel restore iwisglobal-bookings --timestamp=2026-10-26T09:00:00Z
```

Before restoring: note the bookmark that `info` prints now. Restore writes back a "previous bookmark"; if the restore was wrong, restoring to that bookmark undoes it. Limit: 10 restores per 10 minutes.

After restoring: bookings, payments or leads that arrived after the chosen moment are gone from D1. Razorpay and WhatsApp still hold their own records, so reconcile them by hand.

## 2. Export to a file **[Rehearsed locally]**

```
npx wrangler login
node scripts/backup/d1-backup.mjs --remote --output backups/iwis-2026-10-26.sql
```

This only reads from production. It writes the SQL file and a `.manifest.json` beside it (table list, row counts, SHA-256). The file contains customer names, emails, phone numbers and WhatsApp messages. Keep it somewhere private (an encrypted drive or password manager vault), never commit it, never attach it to a pull request or send it in chat. `backups/` is a good local folder name; make sure it is in your `.gitignore` before the first run.

Why not plain `wrangler d1 export`: Cloudflare refuses to export a database that has a search (FTS5) table, and this one has `wa_kb_fts` for the WhatsApp answer search. The tool exports every other table by name and leaves the search tables out, because they are rebuilt from the approved answers.

Known limits of an export file:

- It has tables and rows but **no indexes**. The restore tool puts all 51 back from the `schema*.sql` files.
- It is a snapshot at one moment. Run it before any risky change (schema change, bulk import, framework upgrade) and monthly.

## 3. Restore from a file into an empty database **[Rehearsed locally]**

Always restore into a new, empty database first to prove the file works. Never into production.

```
npx wrangler d1 create iwisglobal-restore-test
# add it to a throwaway wrangler.toml, or restore locally:
node scripts/backup/d1-restore.mjs --file backups/iwis-2026-10-26.sql --remote --db iwisglobal-restore-test
node scripts/backup/d1-restore.mjs --file backups/iwis-2026-10-26.sql --local --cwd /path/to/a/folder/with/wrangler.toml
```

The tool:

1. refuses to run against `iwisglobal-bookings` with `--remote`, and refuses a database that already has tables;
2. loads the tables and rows;
3. re-creates every index from the schema files (51 today);
4. rebuilds the WhatsApp answer search from the approved entries;
5. prints the table and index counts and fails if indexes are missing.

Rehearsal result (local copy built from the schema files): backup of 58 tables, restore gives 64 tables (58 + search table + 5 search shadow tables) and 51 indexes, matching production's structure. Without step 3 a control restore had zero indexes and accepted a duplicate row that the unique index should have blocked, which is why the tool always runs it.

### If production itself must be rebuilt from a file

Only if Time Travel cannot help (for example the database was deleted). Create a new database, restore into it with the tool, point the Pages project's `DB` binding at the new database in Cloudflare, redeploy, and update `database_id` in `wrangler.toml`. Confirm with me before doing this; I will walk through it with you step by step.

## 4. R2 images **[Not rehearsed]**

Cloudflare does not version R2 objects by default. Options, cheapest first:

1. **Do nothing special**: blog and tour images are also in the source material you uploaded (Higgsfield jobs, your own photos). Keep the originals.
2. **Copy the bucket occasionally** with `rclone` (R2 is S3-compatible): create an R2 API token with read access to this bucket only, then `rclone sync r2:iwisglobal-images ~/iwis-images-backup`. Needs a token from you; do not paste it in chat, put it in rclone's config on your own computer.
3. **R2 bucket lock or a second bucket with replication**: heavier; only if image loss would hurt.

## 5. Routine

| When | What |
|---|---|
| Monthly (first Sunday) | Run the export tool, store the file privately, record the manifest's SHA-256 somewhere |
| Quarterly | Restore the latest file into a throwaway database and spot-check a few bookings |
| Before any schema change, bulk import or framework upgrade | Run `time-travel info` and note the bookmark; run an export |

## What needs you

1. `npx wrangler login` on your computer (or a Cloudflare API token with D1 read, kept private).
2. Tell me your Cloudflare plan (Workers Paid or Free), which sets Time Travel at 30 or 7 days.
3. Run one real export and one restore into a throwaway database and tell me the output, so the **[Not rehearsed]** marks can be removed.
