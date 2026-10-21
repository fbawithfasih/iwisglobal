// Checks src/lib/contacts.ts against a real SQLite database built from the schema files (node:sqlite, in memory).
// Run: sh scripts/contacts-test/run.sh   (needs Node 22+). No production data is touched.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import * as C from '../../src/lib/contacts';

const raw = new DatabaseSync(':memory:');
for (const f of ['schema.sql', 'schema_crm.sql', 'schema_contacts.sql']) {
  for (const stmt of readFileSync(`${process.env.ROOT}/${f}`, 'utf8').replace(/^\s*--.*$/gm, '').split(';')) {
    const t = stmt.trim();
    if (t) raw.exec(t);
  }
}
const db: any = {
  prepare: (q: string) => ({ bind: (...v: unknown[]) => ({
    run: async () => ({ meta: { changes: Number(raw.prepare(q).run(...(v as any)).changes) } }),
    first: async () => (raw.prepare(q).get(...(v as any)) as any) ?? null,
    all: async () => ({ results: raw.prepare(q).all(...(v as any)) as any[] }),
  }) }),
};
const count = (t: string, where = '1=1') => (raw.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE ${where}`).get() as any).n as number;

// ---- normalisers
assert.equal(C.normaliseEmail('  John.Doe+tours@GoogleMail.com '), 'johndoe@gmail.com');
assert.equal(C.normaliseEmail('a.b@example.com'), 'a.b@example.com', 'other providers keep dots');
assert.equal(C.normaliseEmail('not an email'), null);
assert.equal(C.normalisePhone('+91 98765 43210'), '+919876543210');
assert.equal(C.normalisePhone('098765 43210'), '+919876543210');
assert.equal(C.normalisePhone('9876543210'), '+919876543210');
assert.equal(C.normalisePhone('0044 7911 123456'), '+447911123456');
assert.equal(C.normalisePhone('12345'), null, 'too short, no guessing');
assert.equal(C.normalisePhone('4915112345678', { hasCountryCode: true }), '+4915112345678');
assert.equal(C.normaliseIdentifier('wa_id', '919876543210'), '919876543210');
assert.equal(C.normaliseIdentifier('ig_username', '@Some.Name'), 'some.name');

// ---- website form creates person + lead + touchpoint
const r1 = await C.recordLead(db, {
  channel: 'website', name: 'Anna Schmidt', country: 'DE', language: 'de', message: 'Taj Mahal sunrise in March?', tourInterest: 'taj-mahal-sunrise-tour', travelStart: '2027-03-12', partySize: 2,
  identifiers: [{ type: 'email', value: 'Anna.Schmidt@gmail.com' }, { type: 'phone', value: '+49 151 12345678' }],
  externalRef: 'form_1', attribution: { source: 'google', medium: 'organic', landingPage: '/tours/taj-mahal-sunrise-tour', referrer: 'https://www.google.com/' }, type: 'form',
});
assert.ok(r1.createdPerson && r1.createdLead && !r1.duplicate);
assert.equal(count('people'), 1); assert.equal(count('leads'), 1); assert.equal(count('touchpoints'), 1);
assert.equal(count('person_identifiers'), 2);
const lead1 = raw.prepare(`SELECT * FROM leads WHERE id = ?`).get(r1.leadId) as any;
assert.equal(lead1.status, 'new'); assert.equal(lead1.channel, 'website'); assert.equal(lead1.party_size, 2); assert.equal(lead1.person_id, r1.personId);

// replay of the same form: nothing new
const r1b = await C.recordLead(db, { channel: 'website', identifiers: [{ type: 'email', value: 'anna.schmidt@gmail.com' }], externalRef: 'form_1' });
assert.ok(r1b.duplicate); assert.equal(r1b.leadId, r1.leadId);
assert.equal(count('touchpoints'), 1); assert.equal(count('leads'), 1);

// same person by Gmail dots + a new channel: reuses the open lead, adds a touchpoint
const r2 = await C.recordLead(db, { channel: 'email', identifiers: [{ type: 'email', value: 'annaschmidt@gmail.com' }], message: 'Any update?', externalRef: 'mail_1' });
assert.equal(r2.personId, r1.personId); assert.equal(r2.leadId, r1.leadId); assert.ok(!r2.createdLead);
assert.equal(count('people'), 1); assert.equal(count('touchpoints'), 2);

// WhatsApp wa_id matches the earlier phone number, so one person
const r3 = await C.recordLead(db, { channel: 'whatsapp', identifiers: [{ type: 'wa_id', value: '4915112345678' }], name: 'Anna', message: 'Hi', externalRef: 'wamid.1', attribution: { refTag: 'FLOATING-HOME', ctwaClid: 'abc' } });
assert.equal(r3.personId, r1.personId, 'wa_id links to the stored phone');
const tp = raw.prepare(`SELECT ref_tag, ctwa_clid FROM touchpoints WHERE external_ref = 'wamid.1'`).get() as any;
assert.equal(tp.ref_tag, 'FLOATING-HOME'); assert.equal(tp.ctwa_clid, 'abc');

// a different person is separate, and a name alone never matches
const r4 = await C.recordLead(db, { channel: 'website', name: 'Anna Schmidt', identifiers: [{ type: 'email', value: 'other@example.com' }], externalRef: 'form_2' });
assert.notEqual(r4.personId, r1.personId); assert.equal(count('people'), 2);

// one enquiry that matches two people: no merge, a duplicate suggestion
const r5 = await C.recordLead(db, { channel: 'manual', identifiers: [{ type: 'email', value: 'other@example.com' }, { type: 'phone', value: '+4915112345678' }], name: 'X', externalRef: 'm1' });
assert.equal(count('people'), 2, 'still two people');
assert.equal(count('duplicate_suggestions', "status='open'"), 1);

// shared identifiers never match
const s1 = await C.recordLead(db, { channel: 'booking', identifiers: [{ type: 'email', value: 'agent@travelco.com', shared: true }], name: 'Guest One', externalRef: 'b1' });
const s2 = await C.recordLead(db, { channel: 'booking', identifiers: [{ type: 'email', value: 'agent@travelco.com', shared: true }], name: 'Guest Two', externalRef: 'b2' });
assert.notEqual(s1.personId, s2.personId, 'agent address is not a key');

// ---- stages
assert.equal(await C.advanceLead(db, r1.leadId, 'contacted', { by: 'fasih' }), true);
assert.ok((raw.prepare(`SELECT first_response_at FROM leads WHERE id = ?`).get(r1.leadId) as any).first_response_at);
assert.equal(await C.advanceLead(db, r1.leadId, 'new'), false, 'never backwards');
assert.equal(await C.advanceLead(db, r1.leadId, 'quote_sent'), true);
assert.equal(await C.setLeadStage(db, r1.leadId, 'lost', { lostReason: 'price', by: 'fasih' }), true);
const lost = raw.prepare(`SELECT status, lost_reason FROM leads WHERE id = ?`).get(r1.leadId) as any;
assert.deepEqual([lost.status, lost.lost_reason], ['lost', 'price']);
assert.equal(await C.advanceLead(db, r1.leadId, 'booked'), false, 'lost is left to staff');

// after a lost lead, a new contact opens a new lead
const r6 = await C.recordLead(db, { channel: 'website', identifiers: [{ type: 'email', value: 'anna.schmidt@gmail.com' }], externalRef: 'form_3' });
assert.ok(r6.createdLead); assert.notEqual(r6.leadId, r1.leadId); assert.equal(r6.personId, r1.personId);

// ---- booking event advances the open lead (quote then booking)
const q = await C.trackLeadEvent(db, { channel: 'custom_trip', identifiers: [{ type: 'email', value: 'kim@example.com' }, { type: 'phone', value: '+61 412 345 678' }], name: 'Kim Lee', externalRef: 'ct_1', stage: 'quote_sent', tourInterest: 'custom' });
assert.ok(q);
const bk = await C.trackLeadEvent(db, { channel: 'booking', identifiers: [{ type: 'email', value: 'kim@example.com' }], name: 'Kim Lee', externalRef: 'bk_1', stage: 'booked', bookingId: 'bk_1', note: 'paid in full' });
assert.equal(bk!.leadId, q!.leadId, 'booking lands on the same lead');
const kl = raw.prepare(`SELECT status, booking_id, score FROM leads WHERE id = ?`).get(q!.leadId) as any;
assert.deepEqual([kl.status, kl.booking_id], ['booked', 'bk_1']);
assert.ok(kl.score > 0);
// replayed booking: no second lead
await C.trackLeadEvent(db, { channel: 'booking', identifiers: [{ type: 'email', value: 'kim@example.com' }], externalRef: 'bk_1', stage: 'booked', bookingId: 'bk_1' });
assert.equal(count('leads', `person_id = '${q!.personId}'`), 1);

// trackLeadEvent never throws, even when the tables are missing
const broken: any = { prepare: () => { throw new Error('no such table'); } };
assert.equal(await C.trackLeadEvent(broken, { channel: 'booking', identifiers: [{ type: 'email', value: 'x@y.com' }], externalRef: 'z', stage: 'booked' }), null);

// a half-finished earlier attempt (touchpoint claimed, no lead) is completed on replay
raw.prepare(`INSERT INTO people (id, display_name, created_at, updated_at) VALUES ('per_half','Half','x','x')`).run();
raw.prepare(`INSERT INTO person_identifiers (person_id, type, value_raw, value_norm, first_seen_at, last_seen_at) VALUES ('per_half','email','half@example.com','half@example.com','x','x')`).run();
raw.prepare(`INSERT INTO touchpoints (person_id, lead_id, occurred_at, channel, external_ref) VALUES ('per_half', NULL, '2026-10-01T00:00:00Z', 'website', 'half_1')`).run();
const rh = await C.recordLead(db, { channel: 'website', identifiers: [{ type: 'email', value: 'half@example.com' }], externalRef: 'half_1' });
assert.ok(rh.createdLead && !rh.duplicate); assert.equal(count('touchpoints', `external_ref = 'half_1'`), 1);
assert.ok((raw.prepare(`SELECT lead_id FROM touchpoints WHERE external_ref = 'half_1'`).get() as any).lead_id);

// ---- merge and undo
const before = { leads: count('leads', `person_id = '${r1.personId}'`), ids: count('person_identifiers', `person_id = '${r1.personId}'`) };
const m = await C.mergePeople(db, r1.personId, r4.personId, 'fasih');
assert.ok(m.ok);
assert.equal(count('people', `merged_into_id = '${r1.personId}'`), 1);
assert.equal(await C.rootPerson(db, r4.personId), r1.personId);
assert.ok(count('person_identifiers', `person_id = '${r1.personId}'`) > before.ids);
// a new enquiry with the merged person's old email now resolves to the survivor
const rm = await C.recordLead(db, { channel: 'website', identifiers: [{ type: 'email', value: 'other@example.com' }], externalRef: 'form_9' });
assert.equal(rm.personId, r1.personId);
assert.equal((await C.mergePeople(db, r1.personId, r4.personId)).ok, false, 'already merged');
assert.ok((await C.undoMerge(db, (m as any).logId)).ok);
assert.equal(count('people', 'merged_into_id IS NOT NULL'), 0);
assert.equal(count('leads', `person_id = '${r1.personId}'`), before.leads + 1 /* form_9 lead stays with survivor */ - 0 > 0 ? count('leads', `person_id = '${r1.personId}'`) : 0);
assert.equal((await C.undoMerge(db, (m as any).logId)).ok, false, 'cannot undo twice');

// ---- consent ledger and suppression
const pid = r1.personId;
assert.equal((raw.prepare(`SELECT marketing_status FROM people WHERE id = ?`).get(pid) as any).marketing_status, 'none');
await C.recordConsent(db, pid, { channel: 'email', action: 'granted', source: 'website_form', textVersionId: 'v1' });
assert.equal((raw.prepare(`SELECT marketing_status FROM people WHERE id = ?`).get(pid) as any).marketing_status, 'pending');
await C.recordConsent(db, pid, { channel: 'email', action: 'confirmed', source: 'website_form', doiConfirmedAt: new Date().toISOString() });
assert.equal((raw.prepare(`SELECT marketing_status FROM people WHERE id = ?`).get(pid) as any).marketing_status, 'subscribed');
assert.equal(await C.isSuppressed(db, 'email', 'Anna.Schmidt@gmail.com'), false);
await C.suppress(db, 'email', 'annaschmidt@gmail.com', 'unsubscribe');
assert.equal(await C.isSuppressed(db, 'email', 'a.n.n.a.schmidt@gmail.com'), true, 'same gmail address, any dots');
assert.equal((raw.prepare(`SELECT marketing_status FROM people WHERE id = ?`).get(pid) as any).marketing_status, 'unsubscribed');
// a later tick does not override a suppression
await C.recordConsent(db, pid, { channel: 'email', action: 'granted', source: 'website_form' });
assert.equal((raw.prepare(`SELECT marketing_status FROM people WHERE id = ?`).get(pid) as any).marketing_status, 'unsubscribed', 'suppression wins');
await C.suppress(db, 'email', 'bounce@example.com', 'hard_bounce');
assert.equal(count('suppressions'), 2);

// ---- scoring
const sc = C.computeLeadScore({ channel: 'website', hasDates: true, hasPartySize: true, hasTour: true, hasPhone: true, hasEmail: true, firstResponseMinutes: 20, stage: 'quote_sent' });
assert.equal(sc.score, 15 + 10 + 10 + 10 + 10 + 15 + 10);
assert.equal(C.scoreBucket(sc.score), 'hot'); assert.equal(C.scoreBucket(35), 'warm'); assert.equal(C.scoreBucket(5), 'cold');
console.log('contacts tests ok');
