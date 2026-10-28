// Checks the pictures on the admin Campaigns list (src/lib/campaignsAdmin.ts) against in-memory SQLite and pure data.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { loadCampaignStats, emptyStats, progressPercent, rate, deliveryHealth, campaignSummary, sortCampaigns, barWidth } from '../../src/lib/campaignsAdmin';

const mk = (files: string[]) => {
  const raw = new DatabaseSync(':memory:');
  for (const f of files) for (const stmt of readFileSync(`${process.env.ROOT}/${f}`, 'utf8').replace(/^\s*--.*$/gm, '').split(';')) { const t = stmt.trim(); if (t) raw.exec(t); }
  const db: any = { prepare: (q: string) => ({ bind: (...v: unknown[]) => ({ all: async () => ({ results: raw.prepare(q).all(...(v as any)) as any[] }) }) }) };
  return { raw, db };
};

// ---- loader: sends, events and clicks grouped per campaign
const { raw, db } = mk(['schema_campaigns.sql', 'schema_events.sql']);
const send = (c: string, p: string, status: string) => raw.prepare(`INSERT INTO campaign_sends (campaign_id, person_id, email, status, queued_at) VALUES (?, ?, ?, ?, '2026-10-01T00:00:00Z')`).run(c, p, `${p}@x.com`, status);
for (let i = 0; i < 8; i++) send('c1', `p${i}`, 'sent');
send('c1', 'q1', 'failed'); send('c1', 'q2', 'skipped'); send('c1', 'q3', 'queued');
send('c2', 'p1', 'sent');
const ev = (id: string, c: string, type: string, rid: string) => raw.prepare(`INSERT INTO email_events (svix_id, type, resend_id, campaign_id, occurred_at, received_at) VALUES (?, ?, ?, ?, 'x', 'x')`).run(id, type, rid, c);
ev('e1', 'c1', 'email.delivered', 'r1'); ev('e2', 'c1', 'email.delivered', 'r2'); ev('e2b', 'c1', 'email.delivered', 'r2'); ev('e3', 'c1', 'email.bounced', 'r3'); ev('e4', 'c1', 'email.complained', 'r4'); ev('e5', '', 'email.delivered', 'r9');
raw.prepare(`INSERT INTO campaign_links (code, campaign_id, url, created_at) VALUES ('a', 'c1', 'https://x', 'x'), ('b', 'c1', 'https://y', 'x')`).run();
raw.prepare(`INSERT INTO campaign_clicks (code, day, clicks) VALUES ('a', 'd1', 3), ('a', 'd2', 2), ('b', 'd1', 1)`).run();
const stats = await loadCampaignStats(db);
assert.deepEqual(stats.get('c1'), { queued: 1, sent: 8, failed: 1, skipped: 1, delivered: 2, bounced: 1, complained: 1, clicks: 6 }, 'distinct resend ids count once; an event with no campaign is ignored');
assert.deepEqual(stats.get('c2'), { ...emptyStats(), sent: 1 });
assert.equal(stats.has('c3'), false);

// ---- the delivery tables not created yet: sends still load, the rest is zero
const bare = mk(['schema_campaigns.sql']);
bare.raw.prepare(`INSERT INTO campaign_sends (campaign_id, person_id, email, status, queued_at) VALUES ('c1', 'p', 'p@x.com', 'sent', 'x')`).run();
assert.deepEqual((await loadCampaignStats(bare.db)).get('c1'), { ...emptyStats(), sent: 1 });

// ---- pure helpers
assert.equal(progressPercent(emptyStats()), 0);
assert.equal(progressPercent({ ...emptyStats(), queued: 3, sent: 7 }), 70);
assert.equal(progressPercent({ ...emptyStats(), sent: 5, failed: 1, skipped: 1 }), 100);
assert.equal(rate(1, 8), 12.5); assert.equal(rate(0, 0), 0); assert.equal(rate(1, 3), 33.3);

const S = (o: Partial<ReturnType<typeof emptyStats>>) => ({ ...emptyStats(), ...o });
assert.equal(deliveryHealth(S({})), 'none');
assert.equal(deliveryHealth(S({ sent: 1000, delivered: 990 })), 'good');
assert.equal(deliveryHealth(S({ sent: 1000, complained: 1 })), 'watch', '0.1% complaints is a warning');
assert.equal(deliveryHealth(S({ sent: 1000, complained: 2 })), 'watch');
assert.equal(deliveryHealth(S({ sent: 1000, complained: 3 })), 'bad', '0.3% complaints is a problem');
assert.equal(deliveryHealth(S({ sent: 100, bounced: 2 })), 'watch', '2% bounces is a warning');
assert.equal(deliveryHealth(S({ sent: 100, bounced: 5 })), 'bad', '5% bounces is a problem');
assert.equal(deliveryHealth(S({ sent: 100, failed: 1 })), 'watch', 'a failed send is worth a look');
assert.equal(deliveryHealth(S({ sent: 400, complained: 1 })), 'watch', '1 in 400 is 0.25%, under the 0.3% line');
assert.equal(deliveryHealth(S({ sent: 333, complained: 1 })), 'bad', '1 in 333 is just over 0.3%');
assert.equal(deliveryHealth(S({ sent: 1000, bounced: 19 })), 'good', '1.9% bounces is fine');

const rows = [
  { status: 'sent', lastError: '', stats: S({ sent: 1000, complained: 3 }) },
  { status: 'sent', lastError: '', stats: S({ sent: 50, delivered: 50 }) },
  { status: 'draft', lastError: '', stats: S({}) },
  { status: 'sending', lastError: 'Resend 429', stats: S({ sent: 10, queued: 90 }) },
  { status: 'scheduled', lastError: '  ', stats: S({}) },
  { status: 'cancelled', lastError: '', stats: S({}) },
];
assert.deepEqual(campaignSummary(rows), { total: 6, draft: 1, scheduled: 1, sending: 1, sent: 2, cancelled: 1, emailsSent: 1060, needsLook: 2 });
assert.deepEqual(campaignSummary([]), { total: 0, draft: 0, scheduled: 0, sending: 0, sent: 0, cancelled: 0, emailsSent: 0, needsLook: 0 });

assert.deepEqual(sortCampaigns([
  { status: 'sent', createdAt: '2026-10-20' }, { status: 'draft', createdAt: '2026-10-01' }, { status: 'sending', createdAt: '2026-09-01' },
  { status: 'draft', createdAt: '2026-10-10' }, { status: 'cancelled', createdAt: '2026-10-25' }, { status: 'scheduled', createdAt: '2026-10-22' },
]).map((r) => `${r.status}:${r.createdAt}`), ['sending:2026-09-01', 'scheduled:2026-10-22', 'draft:2026-10-10', 'draft:2026-10-01', 'sent:2026-10-20', 'cancelled:2026-10-25']);

assert.equal(barWidth(0, 5), 0); assert.equal(barWidth(1, 1000), 4); assert.equal(barWidth(5, 5), 100);
console.log('campaigns admin tests ok');
