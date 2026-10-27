// Page speed guard. The production database is far from the server, so every database call made one after another costs a
// few hundred milliseconds (a 1.12 s Bookings page was measured on 27 Oct 2026). This test gives every query a fixed
// simulated delay and checks how many "rounds" in a row each admin page's data loading needs. If someone makes a page
// fetch things one after another again, this fails.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { loadBookingsAndTours } from '../../src/lib/bookingsAdmin';
import { viewCounts } from '../../src/lib/leadsAdmin';
import { inboxCounts } from '../../src/lib/waInbox';
import { loadToday } from '../../src/lib/todayBoard';
import { loadOwnerOverview } from '../../src/lib/ownerOverview';
import { searchAdmin } from '../../src/lib/adminSearch';
import { loadNotifications } from '../../src/lib/notifications';

// Every schema file, twice: they depend on each other and a file whose table is not there yet fails the first time.
const raw = new DatabaseSync(':memory:');
const files = ['schema.sql', ...readdirSync(process.env.ROOT!).filter((f) => /^schema_.*\.sql$/.test(f)).sort()];
for (let pass = 0; pass < 2; pass++) {
  for (const f of files) {
    for (const stmt of readFileSync(`${process.env.ROOT}/${f}`, 'utf8').replace(/^\s*--.*$/gm, '').split(';')) {
      if (!stmt.trim()) continue;
      try { raw.exec(stmt.trim()); } catch { /* already applied, or needs a table a later file creates */ }
    }
  }
}

const DELAY = 40; // ms per database call, like a long round trip
let calls = 0;
const slow = <T,>(fn: () => T): Promise<T> => new Promise((resolve, reject) => setTimeout(() => { try { resolve(fn()); } catch (e) { reject(e); } }, DELAY));
const make = (q: string, v: unknown[]) => ({
  run: () => { calls++; return slow(() => ({ meta: { changes: Number(raw.prepare(q).run(...(v as any)).changes) } })); },
  first: () => { calls++; return slow(() => (raw.prepare(q).get(...(v as any)) as any) ?? null); },
  all: () => { calls++; return slow(() => ({ results: raw.prepare(q).all(...(v as any)) as any[] })); },
});
const db: any = { prepare: (q: string) => ({ ...make(q, []), bind: (...v: unknown[]) => make(q, v) }) };

/** How many delays in a row the work needed (elapsed time divided by the delay, rounded up). */
async function rounds(label: string, run: () => Promise<unknown>): Promise<{ rounds: number; calls: number }> {
  calls = 0;
  const t0 = Date.now();
  await run();
  const r = Math.ceil((Date.now() - t0) / DELAY - 0.35);
  console.log(`  ${label}: ${r} round(s) in a row, ${calls} database call(s)`);
  return { rounds: r, calls };
}

const NOW = new Date('2026-10-27T12:00:00.000Z');
const b = await rounds('Bookings list', () => loadBookingsAndTours(db));
assert.ok(b.rounds <= 2, `Bookings list needs at most 2 rounds, took ${b.rounds}`);

const v = await rounds('Leads view counts', () => viewCounts(db, NOW.toISOString(), 'owner'));
assert.equal(v.calls, 1, 'all lead view counts come from one query');
assert.ok(v.rounds <= 2);

const w = await rounds('WhatsApp counts', () => inboxCounts(db, 'owner'));
assert.ok(w.rounds <= 2, `WhatsApp counts need at most 2 rounds, took ${w.rounds}`);

const t = await rounds('Today board', () => loadToday(db, { today: '2026-10-27', me: 'owner', now: NOW }));
assert.ok(t.rounds <= 3, `Today board needs at most 3 rounds, took ${t.rounds}`);

const o = await rounds('Owner overview', () => loadOwnerOverview(db, { today: '2026-10-27', now: NOW }));
assert.ok(o.rounds <= 3, `Owner overview needs at most 3 rounds, took ${o.rounds}`);

const sr = await rounds('Global search', () => searchAdmin(db, 'anna'));
assert.equal(sr.calls, 3, 'search is one query per kind of record');
assert.ok(sr.rounds <= 2, `Global search needs at most 2 rounds, took ${sr.rounds}`);

// The bell is refreshed every minute by every open page, so it must stay cheap: one round, a handful of queries.
const nb = await rounds('Notifications bell', () => loadNotifications(db, { me: 'owner', now: NOW }));
assert.ok(nb.rounds <= 2, `The bell needs at most 2 rounds, took ${nb.rounds}`);
assert.ok(nb.calls <= 5, `The bell should stay at 5 queries or fewer, ran ${nb.calls}`);

console.log('speed guard ok');
