// Checks the global admin search (src/lib/adminSearch.ts): what it matches, that wildcards are literal, the minimum length,
// the per-kind limit and "more" flag, and that a lead's message text is not searched.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { MIN_QUERY, PER_KIND, likeTerm, searchAdmin } from '../../src/lib/adminSearch';

const raw = new DatabaseSync(':memory:');
for (const f of ['schema.sql', 'schema_crm.sql', 'schema_booking_locale.sql', 'schema_deposit_payments.sql', 'schema_contacts.sql', 'schema_whatsapp.sql', 'schema_whatsapp_inbox.sql', 'schema_whatsapp_media.sql', 'schema_whatsapp_handler.sql']) {
  for (const stmt of readFileSync(`${process.env.ROOT}/${f}`, 'utf8').replace(/^\s*--.*$/gm, '').split(';')) if (stmt.trim()) raw.exec(stmt.trim());
}
const db: any = { prepare: (q: string) => ({ bind: (...v: unknown[]) => ({
  run: async () => ({ meta: { changes: Number(raw.prepare(q).run(...(v as any)).changes) } }),
  first: async () => (raw.prepare(q).get(...(v as any)) as any) ?? null,
  all: async () => ({ results: raw.prepare(q).all(...(v as any)) as any[] }),
}) }) };

let n = 0;
const booking = (o: { id?: string; name: string; email?: string; phone?: string; created?: string }) => {
  n++;
  raw.prepare(`INSERT INTO bookings (id, payment_id, order_id, tour_id, travel_date, travelers, traveler_name, traveler_email, traveler_phone, amount_paid, currency, created_at, status)
               VALUES (?, ?, ?, 'taj', '2026-11-05', 2, ?, ?, ?, 1000, 'INR', ?, 'confirmed')`).run(o.id ?? `bk_${n}`, `p${n}`, `o${n}`, o.name, o.email ?? `g${n}@example.com`, o.phone ?? '+91 90000 00000', o.created ?? `2026-10-${String(10 + (n % 15)).padStart(2, '0')}T00:00:00Z`);
};
const lead = (o: { name: string; email?: string; phone?: string; message?: string }) => {
  n++;
  raw.prepare(`INSERT INTO leads (id, name, email, phone, message, tour_interest, status, created_at, channel, owner, last_activity_at, updated_at)
               VALUES (?, ?, ?, ?, ?, '', 'new', '2026-10-20T00:00:00Z', 'website', '', '2026-10-20T00:00:00Z', '2026-10-20T00:00:00Z')`).run(`ld_${n}`, o.name, o.email ?? '', o.phone ?? '', o.message ?? '');
};
const chat = (id: string, name: string, at = '2026-10-25T00:00:00Z') =>
  raw.prepare(`INSERT INTO wa_conversations (id, profile_name, state, last_message_at, created_at, handled_by) VALUES (?, ?, 'agent', ?, ?, '')`).run(id, name, at, at);

booking({ id: 'bk_anna', name: 'Anna Schmidt', email: 'anna@example.de', phone: '+49 151 2345 6789' });
booking({ name: 'Raj Patel', email: 'raj@example.in', phone: '+91 98765 43210' });
booking({ name: 'Discount 50% Guest' });
booking({ name: 'Under_score Guest' });
lead({ name: 'Anna Berg', email: 'anna.berg@example.com', phone: '98765-43210' });
lead({ name: 'Zed', message: 'Looking for Anna Schmidt sunrise tour' });   // only the message mentions Anna: must not match
chat('919876543210', 'Raj WhatsApp');
chat('4915123456789', 'Anna S');

// ---- length and escaping
assert.equal((await searchAdmin(db, 'a')).tooShort, true);
assert.equal((await searchAdmin(db, '   ')).tooShort, true);
assert.equal((await searchAdmin(db, 'a')).bookings.length, 0, 'a one-letter search returns nothing');
assert.equal(MIN_QUERY, 2);
assert.equal(likeTerm('50%_x\\'), '%50\\%\\_x\\\\%');

// ---- names, emails, ids across the three kinds
let r = await searchAdmin(db, 'anna');
assert.deepEqual(r.bookings.map((b) => b.id), ['bk_anna']);
assert.deepEqual(r.leads.map((l) => l.name), ['Anna Berg'], "a lead's free-text message is not searched");
assert.deepEqual(r.chats.map((c) => c.id), ['4915123456789'], 'chat matched by its WhatsApp name');
assert.equal(r.more.bookings || r.more.leads || r.more.chats, false);

r = await searchAdmin(db, 'ANNA@EXAMPLE.DE');
assert.deepEqual(r.bookings.map((b) => b.id), ['bk_anna'], 'case-insensitive email');

r = await searchAdmin(db, 'bk_ann');
assert.deepEqual(r.bookings.map((b) => b.id), ['bk_anna'], 'booking id');

// ---- phone digits in any shape, all three kinds
r = await searchAdmin(db, '+91 98765 43210');
assert.equal(r.bookings.length, 1);
assert.equal(r.leads.length, 1, 'lead stored as 98765-43210 matches a number typed with the country code');
assert.deepEqual(r.chats.map((c) => c.id), ['919876543210'], 'chat id is the WhatsApp number');
r = await searchAdmin(db, '4321');
assert.equal(r.bookings.length, 1, 'four digits are enough');
r = await searchAdmin(db, '321');
assert.equal(r.bookings.length + r.leads.length + r.chats.length, 0, 'three digits are not treated as a phone');

// ---- wildcards are literal
r = await searchAdmin(db, '50%');
assert.deepEqual(r.bookings.map((b) => b.traveler_name), ['Discount 50% Guest']);
r = await searchAdmin(db, '%%');
assert.equal(r.bookings.length, 0, '%% does not match everything');
r = await searchAdmin(db, 'r_s');
assert.deepEqual(r.bookings.map((b) => b.traveler_name), ['Under_score Guest'], 'a real underscore matches');
r = await searchAdmin(db, 'u_d');
assert.equal(r.bookings.length, 0, '_ is not a one-character wildcard ("u_d" would match "und" if it were)');

// ---- limit and "more"
for (let i = 0; i < PER_KIND + 3; i++) booking({ name: `Bulk Guest ${i}` });
r = await searchAdmin(db, 'bulk guest');
assert.equal(r.bookings.length, PER_KIND);
assert.equal(r.more.bookings, true);
assert.equal(r.more.leads, false);
// newest first
assert.ok(r.bookings.every((b, i, a) => i === 0 || a[i - 1].id !== b.id));

// ---- a quote or backslash in the search is harmless
r = await searchAdmin(db, `o'brien"; DROP TABLE bookings; --`);
assert.equal(r.bookings.length, 0);
assert.ok(raw.prepare(`SELECT count(*) AS n FROM bookings`).get() as any);
console.log('admin search tests ok');
