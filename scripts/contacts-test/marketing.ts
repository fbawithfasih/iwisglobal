// Checks src/lib/marketing.ts (double opt-in, unsubscribe, erasure) against in-memory SQLite with a stubbed Resend.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import * as C from '../../src/lib/contacts';
import * as K from '../../src/lib/marketing';
import { SIGNUP_LANGS, signupLink, signupMessage } from '../../src/lib/waSignup';

const raw = new DatabaseSync(':memory:');
for (const f of ['schema.sql', 'schema_crm.sql', 'schema_booking_locale.sql', 'schema_deposit_payments.sql', 'schema_whatsapp.sql', 'schema_whatsapp_media.sql', 'schema_contacts.sql', 'schema_marketing.sql']) {
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
const status = (id: string) => (raw.prepare(`SELECT marketing_status AS s FROM people WHERE id = ?`).get(id) as any).s as string;

// Resend stub: keeps the emails so the confirmation link can be read back.
const sent: any[] = [];
(globalThis as any).fetch = async (_url: string, init: any) => {
  sent.push(JSON.parse(init.body));
  return new Response('{}', { status: 200 });
};
const env = { RESEND_API_KEY: 're_test' };
const tokenFrom = (mail: any) => decodeURIComponent(/confirm-subscription\?t=([^&\s]+)/.exec(mail.text)![1]);

// ---- tokens
const tok = await K.signUnsubscribeToken('secret', 'per_abc-123');
assert.equal(await K.verifyUnsubscribeToken('secret', tok), 'per_abc-123');
assert.equal(await K.verifyUnsubscribeToken('other', tok), null, 'wrong secret');
assert.equal(await K.verifyUnsubscribeToken('secret', tok.replace('per_abc', 'per_abd')), null, 'changed id');
assert.equal(await K.verifyUnsubscribeToken(undefined, tok), null, 'no secret configured');
assert.notEqual(await K.consentVersionId('f', 'text one'), await K.consentVersionId('f', 'text two'), 'wording change gives a new version id');

// ---- a newsletter signup: person and touchpoint, no lead
const up = await C.upsertPerson(db, [{ type: 'email', value: 'Mia.Roth@gmail.com', source: 'newsletter' }], { language: 'de' });
await C.recordTouchpoint(db, { personId: up.personId, channel: 'website', type: 'newsletter', externalRef: 'newsletter:1' });
assert.equal(count('leads'), 0, 'a newsletter signup is not an enquiry');
assert.equal(count('touchpoints', `person_id = '${up.personId}' AND type = 'newsletter'`), 1);

// ---- double opt-in
await C.recordConsent(db, up.personId, { channel: 'email', action: 'granted', source: 'website_form', formId: 'footer_newsletter', textVersionId: 'v1' });
assert.equal(status(up.personId), 'pending', 'ticking the box is not enough');
assert.equal(await K.startDoubleOptIn(env, db, up.personId, 'Mia.Roth@gmail.com', 'de'), 'sent');
assert.equal(sent.length, 1); assert.equal(sent[0].to, 'Mia.Roth@gmail.com');
assert.ok(sent[0].subject.includes('bestätigen'), 'sent in the person\'s language');
assert.ok(!/angebot|offer/i.test(sent[0].html.replace(/Reiseideen und Angebote/g, '')), 'the confirmation itself is not promotional');
const t1 = tokenFrom(sent[0]);
assert.equal(count('email_confirmations'), 1);
assert.ok(!(raw.prepare(`SELECT token_hash FROM email_confirmations`).get() as any).token_hash.includes(t1), 'only the hash is stored');
assert.equal((await K.listSubscribed(db)).length, 0, 'pending people are not mailable');

assert.deepEqual(await K.confirmOptIn(db, 'not-a-token'), { ok: false });
const ok = await K.confirmOptIn(db, t1, { userAgent: 'test' });
assert.ok(ok.ok); assert.equal(status(up.personId), 'subscribed');
const ev = raw.prepare(`SELECT * FROM consent_events WHERE action = 'confirmed'`).get() as any;
assert.ok(ev.doi_confirmed_at && ev.doi_token_hash && ev.doi_sent_at && ev.text_version_id === 'v1', 'proof: when sent, when confirmed, wording shown');
assert.deepEqual(await K.confirmOptIn(db, t1), { ok: false }, 'a link works once');
assert.equal((await K.listSubscribed(db)).length, 1);
assert.equal(await K.startDoubleOptIn(env, db, up.personId, 'Mia.Roth@gmail.com'), 'already');

// ---- expired link
await C.upsertPerson(db, [{ type: 'email', value: 'late@example.com' }]);
const late = await C.upsertPerson(db, [{ type: 'email', value: 'late@example.com' }]);
await K.startDoubleOptIn(env, db, late.personId, 'late@example.com');
const tLate = tokenFrom(sent[sent.length - 1]);
raw.exec(`UPDATE email_confirmations SET expires_at = '2000-01-01T00:00:00.000Z' WHERE email = 'late@example.com'`);
assert.deepEqual(await K.confirmOptIn(db, tLate), { ok: false }, 'expired');
assert.equal(status(late.personId), 'none');

// ---- rate limit: three confirmations an hour per address
for (let i = 0; i < 2; i++) await K.startDoubleOptIn(env, db, late.personId, 'late@example.com');
assert.equal(await K.startDoubleOptIn(env, db, late.personId, 'late@example.com'), 'rate_limited');

// ---- unsubscribe stops everything, permanently
assert.equal(await K.unsubscribePerson(db, up.personId), 1);
assert.equal(status(up.personId), 'unsubscribed');
assert.equal(await C.isSuppressed(db, 'email', 'miaroth@gmail.com'), true, 'same gmail address, any dots');
assert.equal((await K.listSubscribed(db)).length, 0);

// ---- a fresh, confirmed opt-in lifts an unsubscribe (but nothing else)
assert.equal(await K.startDoubleOptIn(env, db, up.personId, 'Mia.Roth@gmail.com', 'de'), 'sent');
const t2 = tokenFrom(sent[sent.length - 1]);
assert.ok((await K.confirmOptIn(db, t2)).ok);
assert.equal(status(up.personId), 'subscribed');
assert.equal(await C.isSuppressed(db, 'email', 'miaroth@gmail.com'), false);

// ---- complaints, bounces and erasures are never lifted by a signup
const bad = await C.upsertPerson(db, [{ type: 'email', value: 'angry@example.com' }]);
await C.suppress(db, 'email', 'angry@example.com', 'complaint');
assert.equal(await K.startDoubleOptIn(env, db, bad.personId, 'angry@example.com'), 'blocked');
assert.equal(status(bad.personId), 'complained');

// ---- erasure keeps only a hashed suppression
const lead = await C.recordLead(db, { channel: 'website', name: 'Mia Roth', identifiers: [{ type: 'email', value: 'Mia.Roth@gmail.com' }, { type: 'phone', value: '+49 151 12345678' }], message: 'private text', externalRef: 'form:erase' });
assert.equal(lead.personId, up.personId);
await K.erasePerson(db, up.personId);
assert.equal(count('person_identifiers', `person_id = '${up.personId}'`), 0);
assert.equal(count('touchpoints', `person_id = '${up.personId}'`), 0);
assert.equal(count('consent_events', `person_id = '${up.personId}'`), 0);
const l = raw.prepare(`SELECT name, email, phone, message FROM leads WHERE id = ?`).get(lead.leadId) as any;
assert.deepEqual([l.name, l.email, l.phone, l.message], ['(erased)', '', '', '']);
const sup = raw.prepare(`SELECT reason, identifier_plain FROM suppressions WHERE reason = 'erasure' AND channel = 'email'`).get() as any;
assert.equal(sup.identifier_plain, '', 'no readable address kept');
assert.equal(await C.isSuppressed(db, 'email', 'Mia.Roth@gmail.com'), true, 'still never emailed again');
assert.equal((raw.prepare(`SELECT display_name FROM people WHERE id = ?`).get(up.personId) as any).display_name, '(erased)');

// ---- signup boxes: the shared helper and the booking-page offer rule
const leadsBefore = count('leads');
const sentBefore = sent.length;
assert.equal(await K.canOfferSignup(db, 'guest@example.com'), true, 'an unknown address is offered the box');
const wording = 'I agree to receive travel ideas.';
const su = await K.signUpForEmail(env, db, { email: 'guest@example.com', locale: 'en', page: '/booking/confirmation', formId: 'booking_confirmation', source: 'booking_confirmation', consentText: wording, ipHash: 'h' });
assert.equal(su.optIn, 'sent');
assert.equal(sent.length, sentBefore + 1, 'one confirmation email');
assert.equal(count('leads'), leadsBefore, 'a signup box never opens a lead');
assert.equal(status(su.personId), 'pending', 'not subscribed until confirmed');
const ce = raw.prepare(`SELECT form_id, text_version_id FROM consent_events WHERE person_id = ? AND action = 'granted'`).get(su.personId) as any;
assert.equal(ce.form_id, 'booking_confirmation');
assert.equal(ce.text_version_id, await K.consentVersionId('booking-confirmation', wording), 'the stored version points at the exact wording');
assert.equal((raw.prepare(`SELECT text FROM consent_texts WHERE version_id = ?`).get(ce.text_version_id) as any).text, wording);
assert.equal(await K.canOfferSignup(db, 'guest@example.com'), false, 'not asked again while waiting for confirmation');
await K.confirmOptIn(db, tokenFrom(sent[sent.length - 1]));
assert.equal(status(su.personId), 'subscribed');
assert.equal(await K.canOfferSignup(db, 'guest@example.com'), false, 'not asked once subscribed');
await C.suppress(db, 'email', 'optout@example.com', 'unsubscribe');
assert.equal(await K.canOfferSignup(db, 'optout@example.com'), false, 'someone who opted out is not asked again');
await C.suppress(db, 'email', 'spam@example.com', 'complaint');
assert.equal(await K.canOfferSignup(db, 'spam@example.com'), false);
assert.equal(await K.canOfferSignup(db, 'not an email'), false);

// ---- the WhatsApp signup line and the standalone page's form id
for (const l of SIGNUP_LANGS) {
  const m = signupMessage(l);
  assert.equal(m.split('https://www.iwisglobal.com/subscribe?src=whatsapp').length, 2, `${l}: one link`);
  assert.ok(!m.includes('{link}'), `${l}: link filled in`);
  assert.equal(m.includes('&lang='), l !== 'en', `${l}: language only on the link when not English`);
}
assert.equal(signupMessage('xx'), signupMessage('en'), 'unknown language falls back to English');
assert.equal(signupLink('de'), 'https://www.iwisglobal.com/subscribe?src=whatsapp&lang=de');
const sp = await K.signUpForEmail(env, db, { email: 'wa.guest@example.com', locale: 'de', page: '/subscribe', formId: 'subscribe_page', source: 'whatsapp_link', consentText: wording, ipHash: 'h' });
assert.equal(sp.optIn, 'sent');
assert.ok((raw.prepare(`SELECT text_version_id AS v FROM consent_events WHERE person_id = ? AND action = 'granted'`).get(sp.personId) as any).v.startsWith('subscribe-page-'));
assert.equal((raw.prepare(`SELECT source FROM touchpoints WHERE person_id = ? AND type = 'newsletter'`).get(sp.personId) as any).source, 'whatsapp_link', 'the signup is recorded as coming from WhatsApp');
assert.equal(count('leads', `person_id = '${sp.personId}'`), 0);
console.log('marketing tests ok');
