// A guest who already has a booking and writes to us is a client, not a new lead: the message joins their booked lead,
// no lead is created (so no "New lead" alert is sent). Forms and lead ads still open a lead.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { recordLead } from '../../src/lib/contacts';

const raw = new DatabaseSync(':memory:');
for (const f of ['schema.sql', 'schema_crm.sql', 'schema_booking_locale.sql', 'schema_deposit_payments.sql', 'schema_contacts.sql']) {
  for (const stmt of readFileSync(`${process.env.ROOT}/${f}`, 'utf8').replace(/^\s*--.*$/gm, '').split(';')) if (stmt.trim()) raw.exec(stmt.trim());
}
const db: any = { prepare: (q: string) => ({ bind: (...v: unknown[]) => ({
  run: async () => ({ meta: { changes: Number(raw.prepare(q).run(...(v as any)).changes) } }),
  first: async () => (raw.prepare(q).get(...(v as any)) as any) ?? null,
  all: async () => ({ results: raw.prepare(q).all(...(v as any)) as any[] }),
}) }) };

const NOW = '2026-10-28T09:18:03.000Z';
const day = (offset: number) => new Date(Date.parse(NOW) + offset * 86_400_000).toISOString().slice(0, 10);
let n = 0;
// A guest who booked: person, booking, and the booked lead the booking created.
async function bookedGuest(phone: string, travelOffset: number, bookingStatus = 'confirmed') {
  const k = ++n;
  const first = await recordLead(db, {
    channel: 'booking', identifiers: [{ type: 'phone', value: phone, source: 'booking' }], name: `Guest ${k}`, type: 'booking',
    externalRef: `bk_${k}`, occurredAt: '2026-10-20T00:00:00.000Z', stage: 'booked',
  });
  raw.prepare(`INSERT INTO bookings (id, payment_id, order_id, tour_id, travel_date, travelers, add_on_ids, traveler_name, traveler_email, traveler_phone, amount_paid, currency, status, source, created_at, total_amount, payment_type)
    VALUES (?, ?, ?, 'taj', ?, 2, '', ?, '', ?, 1000, 'INR', ?, 'website', '2026-10-20T00:00:00Z', 1000, 'full')`).run(`bk_${k}`, `pay${k}`, `ord${k}`, day(travelOffset), `Guest ${k}`, phone, bookingStatus);
  raw.prepare(`UPDATE leads SET booking_id = ?, status = 'booked' WHERE id = ?`).run(`bk_${k}`, first.leadId);
  return first;
}
const leadCount = () => (raw.prepare(`SELECT COUNT(*) AS n FROM leads`).get() as any).n as number;
const wa = (phone: string, id: string, body = 'hello') => recordLead(db, {
  channel: 'whatsapp', identifiers: [{ type: 'wa_id', value: phone.replace(/\D/g, ''), source: 'whatsapp' }], name: 'Guest', message: body,
  type: 'message', externalRef: id, occurredAt: NOW,
});

// ---- a WhatsApp message from a guest with an upcoming trip joins the booked lead
const g1 = await bookedGuest('+49 160 9525444', 1);
const before = leadCount();
const r1 = await wa('+49 160 9525444', 'wamid.1', '[unsupported: a message of type "album"]');
assert.equal(r1.createdLead, false, 'no new lead, so no "New lead" email');
assert.equal(r1.leadId, g1.leadId, 'it joins the booked lead');
assert.equal(leadCount(), before, 'no lead was created');
assert.equal((raw.prepare(`SELECT status FROM leads WHERE id = ?`).get(g1.leadId) as any).status, 'booked', 'the lead stays booked');
const act = raw.prepare(`SELECT body FROM lead_activities WHERE lead_id = ? ORDER BY id DESC LIMIT 1`).get(g1.leadId) as any;
assert.match(act.body, /^Contact via WhatsApp/, 'it is on the lead timeline');
assert.equal((raw.prepare(`SELECT last_activity_at FROM leads WHERE id = ?`).get(g1.leadId) as any).last_activity_at, NOW);

// a replay of the same message changes nothing
const again = await wa('+49 160 9525444', 'wamid.1');
assert.equal(again.duplicate, true);
assert.equal(leadCount(), before);

// ---- a trip that ended recently (30 days ago) is still the same client
const g2 = await bookedGuest('+91 98765 43210', -30);
const r2 = await wa('+91 98765 43210', 'wamid.2');
assert.deepEqual([r2.createdLead, r2.leadId], [false, g2.leadId]);

// ---- a trip that ended long ago (200 days): a returning guest is a fresh enquiry
await bookedGuest('+44 7700 900123', -200);
const r3 = await wa('+44 7700 900123', 'wamid.3', 'Hi, planning another trip');
assert.equal(r3.createdLead, true);

// ---- a cancelled booking does not count
await bookedGuest('+33 6 12 34 56 78', 5, 'cancelled');
const r4 = await wa('+33 6 12 34 56 78', 'wamid.4');
assert.equal(r4.createdLead, true);

// ---- a form or a lead ad from a booked guest is a deliberate new enquiry and still opens a lead
const f = await recordLead(db, {
  channel: 'website', identifiers: [{ type: 'phone', value: '+49 160 9525444', source: 'enquiry_form' }], name: 'Guest 1', message: 'Another tour please',
  type: 'form', externalRef: 'form-1', occurredAt: NOW,
});
assert.equal(f.createdLead, true, 'a form is still a new enquiry');

// ---- an email from a booked guest joins the booking too
const g5 = await recordLead(db, { channel: 'booking', identifiers: [{ type: 'email', value: 'anna@example.com', source: 'booking' }], name: 'Anna', type: 'booking', externalRef: 'bk_anna', occurredAt: '2026-10-20T00:00:00.000Z', stage: 'booked' });
raw.prepare(`UPDATE leads SET status = 'booked' WHERE id = ?`).run(g5.leadId);
const mail = await recordLead(db, { channel: 'email', identifiers: [{ type: 'email', value: 'Anna@Example.com', source: 'inbound_email' }], name: 'Anna', message: 'Question about pickup', type: 'email', externalRef: '<m1@x>', occurredAt: NOW });
assert.deepEqual([mail.createdLead, mail.leadId], [false, g5.leadId]);

// ---- someone with an OPEN lead is unchanged (the open lead is reused as before)
const o = await recordLead(db, { channel: 'website', identifiers: [{ type: 'phone', value: '+1 202 555 0101', source: 'enquiry_form' }], name: 'Open', type: 'form', externalRef: 'form-2', occurredAt: NOW });
const om = await wa('+1 202 555 0101', 'wamid.5');
assert.deepEqual([om.createdLead, om.leadId], [false, o.leadId]);

// ---- a stranger's first message still opens a lead
const s = await wa('+81 90 1234 5678', 'wamid.6');
assert.equal(s.createdLead, true);
console.log('booked client tests ok');
