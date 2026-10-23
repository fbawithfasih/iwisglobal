// Checks src/lib/inboundEmail.ts (enquiry emails -> leads) against in-memory SQLite.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import * as E from '../../src/lib/inboundEmail';

const raw = new DatabaseSync(':memory:');
for (const f of ['schema.sql', 'schema_crm.sql', 'schema_booking_locale.sql', 'schema_deposit_payments.sql', 'schema_whatsapp.sql', 'schema_contacts.sql']) {
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
const env = {};

// ---- rules
assert.equal(E.ignoreReason({ from: { address: 'noreply@shop.com' }, subject: 'Hi' }), 'automated sender');
assert.equal(E.ignoreReason({ from: { address: 'anna@iwisglobal.com' } }), 'from our own domain');
assert.equal(E.ignoreReason({ from: { address: 'a@b.com' }, subject: 'Out of office: back Monday' }), 'automatic reply or bounce');
assert.equal(E.ignoreReason({ from: { address: 'a@b.com' }, headers: { 'auto-submitted': 'auto-replied' } }), 'automatic message');
assert.equal(E.ignoreReason({ from: { address: 'a@b.com' }, headers: { 'list-unsubscribe': '<mailto:x>' } }), 'bulk or automatic message');
assert.equal(E.ignoreReason({ from: { address: 'not-an-address' } }), 'no valid sender');
assert.equal(E.ignoreReason({ from: { address: 'anna@gmail.com' }, subject: 'Taj tour?' }), null);
assert.equal(E.marketplaceOf('abc123@reply.getyourguide.com'), 'GetYourGuide');
assert.equal(E.marketplaceOf('x@mail.viator.com'), 'Viator');
assert.equal(E.marketplaceOf('x@notgetyourguide.com'), null, 'only real subdomains');
assert.equal(E.bookingRef('Your booking GYGABC12345 is confirmed'), 'GYGABC12345');
assert.equal(E.bookingRef('Booking reference: VX-99887766'), 'VX-99887766');

// ---- a normal enquiry becomes a lead, a thread reply joins it
const a = await E.handleInboundEmail(env, db, { from: { address: 'Anna.Berg@gmail.com', name: 'Anna Berg' }, subject: 'Sunrise Taj tour in March', text: 'Hello, price for 2?', messageId: '<m1@mail>' });
assert.equal(a.status, 'lead');
const lead = raw.prepare(`SELECT * FROM leads WHERE id = ?`).get(a.leadId!) as any;
assert.equal(lead.channel, 'email'); assert.equal(lead.name, 'Anna Berg'); assert.equal(lead.email, 'Anna.Berg@gmail.com');
const again = await E.handleInboundEmail(env, db, { from: { address: 'annaberg@gmail.com' }, subject: 'Re: Sunrise Taj tour in March', text: 'And private car?', messageId: '<m2@mail>' });
assert.equal(again.leadId, a.leadId, 'same person (gmail dots), same open lead');
const replay = await E.handleInboundEmail(env, db, { from: { address: 'Anna.Berg@gmail.com' }, subject: 'x', messageId: '<m1@mail>' });
assert.equal(replay.leadId, a.leadId); assert.equal(count('leads'), 1); assert.equal(count('touchpoints'), 2, 'replay adds nothing');

// ---- ignored mail creates nothing
const ig = await E.handleInboundEmail(env, db, { from: { address: 'mailer-daemon@googlemail.com' }, subject: 'Delivery Status Notification', messageId: '<b1>' });
assert.equal(ig.status, 'ignored'); assert.equal(count('leads'), 1);

// ---- marketplace: relay address is shared (never matched), no marketing
const g1 = await E.handleInboundEmail(env, db, { from: { address: 'relay-77@reply.getyourguide.com', name: 'Jo (GetYourGuide)' }, subject: 'New booking GYGXYZ998877', text: 'Booking GYGXYZ998877 for 3 travellers', messageId: '<g1>' });
const mp = raw.prepare(`SELECT * FROM leads WHERE id = ?`).get(g1.leadId!) as any;
assert.equal(mp.channel, 'marketplace'); assert.ok(mp.message.includes('GYGXYZ998877'));
assert.equal(count('person_identifiers', `value_raw = 'relay-77@reply.getyourguide.com' AND is_shared = 1`), 1);
assert.equal(count('consent_events'), 0);
console.log('email tests ok');
