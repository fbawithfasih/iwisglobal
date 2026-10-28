// Checks the pictures on the admin Leads page (src/lib/leadsAdmin.ts): the open pipeline, enquiries by channel, reply speed.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { loadLeadInsights, summariseSpeed, minutesLabel, PIPELINE_STAGES } from '../../src/lib/leadsAdmin';

const raw = new DatabaseSync(':memory:');
for (const f of ['schema.sql', 'schema_crm.sql', 'schema_booking_locale.sql', 'schema_deposit_payments.sql', 'schema_contacts.sql', 'schema_whatsapp.sql', 'schema_whatsapp_inbox.sql', 'schema_whatsapp_media.sql', 'schema_whatsapp_handler.sql']) {
  for (const stmt of readFileSync(`${process.env.ROOT}/${f}`, 'utf8').replace(/^\s*--.*$/gm, '').split(';')) if (stmt.trim()) raw.exec(stmt.trim());
}
const db: any = {
  prepare: (q: string) => ({ bind: (...v: unknown[]) => ({
    run: async () => ({ meta: { changes: Number(raw.prepare(q).run(...(v as any)).changes) } }),
    first: async () => (raw.prepare(q).get(...(v as any)) as any) ?? null,
    all: async () => ({ results: raw.prepare(q).all(...(v as any)) as any[] }),
  }) }),
};
const NOW = '2026-10-27T12:00:00.000Z';
const ago = (h: number) => new Date(Date.parse(NOW) - h * 3_600_000).toISOString();
let n = 0;
const lead = (o: { status?: string; channel?: string; createdH: number; replyMin?: number }) => {
  n++;
  const created = ago(o.createdH);
  const reply = o.replyMin === undefined ? null : new Date(Date.parse(created) + o.replyMin * 60_000).toISOString();
  raw.prepare(`INSERT INTO leads (id, name, email, phone, message, tour_interest, status, created_at, channel, first_response_at, last_activity_at, updated_at)
               VALUES (?, 'L', '', '', '', '', ?, ?, ?, ?, ?, ?)`).run(`ld${n}`, o.status ?? 'new', created, o.channel ?? 'website', reply, created, created);
};
lead({ createdH: 1 });                                            // new, unanswered
lead({ createdH: 2, status: 'contacted', replyMin: 10 });
lead({ createdH: 3, status: 'contacted', replyMin: 50, channel: 'whatsapp' });
lead({ createdH: 30, status: 'quote_sent', replyMin: 200, channel: 'whatsapp' });
lead({ createdH: 40, status: 'booked', replyMin: 30, channel: 'fb_lead_ad' });
lead({ createdH: 50, status: 'lost', replyMin: 5 });
lead({ createdH: 5, status: 'spam', channel: 'email' });          // spam: not an enquiry
lead({ createdH: 24 * 40, channel: 'phone', replyMin: 5 });       // 40 days ago: outside the window

const i = await loadLeadInsights(db, NOW);
assert.deepEqual(i.pipeline, { new: 2, contacted: 2, qualified: 0, quote_sent: 1, deposit_paid: 0 }, 'open leads only: booked, lost and spam are not in the pipeline');
assert.equal(PIPELINE_STAGES.length, 5);
assert.deepEqual(i.channels.map((c) => [c.channel, c.count]), [['website', 3], ['whatsapp', 2], ['fb_lead_ad', 1]], 'by channel over 30 days, most first, spam and old ones left out');
assert.deepEqual([i.speed.total, i.speed.answered, i.speed.withinHour], [6, 5, 4], 'six enquiries in the window; five answered; four of them inside an hour');
assert.equal(i.speed.medianMinutes, 30, 'the middle of the five answered times 5, 10, 30, 50 and 200 minutes');

// The pure parts.
assert.deepEqual(summariseSpeed([]), { total: 0, answered: 0, withinHour: 0, medianMinutes: null });
assert.equal(summariseSpeed([{ created_at: '2026-10-27T10:00:00Z', first_response_at: '2026-10-27T10:10:00Z' }, { created_at: '2026-10-27T10:00:00Z', first_response_at: '2026-10-27T10:30:00Z' }]).medianMinutes, 20, 'even count: the two in the middle averaged');
assert.equal(summariseSpeed([{ created_at: '2026-10-27T10:00:00Z', first_response_at: '2026-10-27T09:00:00Z' }]).medianMinutes, 0, 'a reply stamped before the lead is read as immediate, never negative');
assert.deepEqual([5, 59, 60, 200, 1440, 2 * 1440].map(minutesLabel), ['5 min', '59 min', '1 h', '3 h 20 min', '1 day', '2 days']);
console.log('leads insights tests ok');
