// Checks WhatsApp photos, voice notes, documents, locations, reactions and unsupported messages:
// what parseWebhook keeps, what is stored, the copy to R2, the draft each one gets, and the purge.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { parseWebhook, storeWebhook, isSilentMessage, unsupportedLabel } from '../../src/lib/whatsapp';
import { copyNewMedia, copyMediaToR2, isInlineMime, mediaKey, deleteOldMedia, MAX_MEDIA_BYTES } from '../../src/lib/waMedia';
import { generateDraft, nonTextReply } from '../../src/lib/waDraft';
import { purgeOld } from '../../src/lib/waLearning';
import { deleteWaMessage, deleteWaChat } from '../../src/lib/waDelete';

const raw = new DatabaseSync(':memory:');
for (const f of ['schema_whatsapp.sql', 'schema_whatsapp_media.sql', 'schema_whatsapp_kb.sql', 'schema_whatsapp_inbox.sql', 'schema_whatsapp_learning.sql', 'schema_whatsapp_tools.sql', 'schema_whatsapp_auto.sql']) {
  for (const stmt of readFileSync(`${process.env.ROOT}/${f}`, 'utf8').replace(/--.*$/gm, '').split(';')) {
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
const row = (waId: string) => raw.prepare(`SELECT * FROM wa_messages WHERE wa_message_id = ?`).get(waId) as any;

const now = Math.floor(Date.now() / 1000);
const msg = (id: string, type: string, part: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ from: '919811122233', id, timestamp: String(now), type, ...part, ...extra });
const payload = {
  entry: [{ changes: [{ value: {
    contacts: [{ wa_id: '919811122233', profile: { name: 'Asha' } }],
    messages: [
      msg('wamid.photo', 'image', { image: { id: 'M1', mime_type: 'image/jpeg', caption: 'Is this the hotel?' } }),
      msg('wamid.photo2', 'image', { image: { id: 'M2', mime_type: 'image/jpeg' } }),
      msg('wamid.voice', 'audio', { audio: { id: 'M3', mime_type: 'audio/ogg; codecs=opus', voice: true } }),
      msg('wamid.doc', 'document', { document: { id: 'M4', mime_type: 'application/pdf', filename: 'passport.pdf' } }),
      msg('wamid.loc', 'location', { location: { latitude: 27.1751, longitude: 78.0421, name: 'Taj Mahal', address: 'Agra' } }),
      msg('wamid.card', 'contacts', { contacts: [{ name: { formatted_name: 'Ravi' }, phones: [{ phone: '+91 98111 00000' }] }] }),
      msg('wamid.react', 'reaction', { reaction: { message_id: 'wamid.out1', emoji: '👍' } }),
      msg('wamid.edit', 'unsupported', { unsupported: { type: 'edit' } }, { errors: [{ code: 131051, title: 'Message type unknown', error_data: { details: 'Message type is currently not supported.' } }] }),
      msg('wamid.poll', 'unsupported', { unsupported: { type: 'poll' } }),
      msg('wamid.btn', 'button', { button: { text: 'Yes, book it' } }),
    ],
  } }] }],
};

// ---- parsing
const parsed = parseWebhook(payload);
const by = new Map(parsed.messages.map((m) => [m.waMessageId, m]));
assert.equal(by.get('wamid.photo')!.body, '[photo] Is this the hotel?');
assert.deepEqual(by.get('wamid.photo')!.media, { id: 'M1', mime: 'image/jpeg' });
assert.equal(by.get('wamid.photo')!.meta!.caption, 'Is this the hotel?');
assert.equal(by.get('wamid.voice')!.body, '[voice note]');
assert.equal(by.get('wamid.voice')!.meta!.voice, true);
assert.equal(by.get('wamid.doc')!.body, '[document: passport.pdf]');
assert.equal(by.get('wamid.loc')!.body, '[location] Taj Mahal, Agra');
assert.equal(by.get('wamid.loc')!.meta!.latitude, 27.1751);
assert.equal(by.get('wamid.card')!.body, '[contact card] Ravi +91 98111 00000');
assert.equal(by.get('wamid.react')!.body, '[reaction 👍]');
assert.equal(by.get('wamid.edit')!.body, '[unsupported: an edited message]');
assert.equal(by.get('wamid.edit')!.meta!.unsupportedType, 'edit');
assert.equal(by.get('wamid.edit')!.meta!.error, 'Message type is currently not supported.');
assert.equal(by.get('wamid.poll')!.body, '[unsupported: a poll]');
assert.equal(unsupportedLabel(undefined), 'a message type WhatsApp does not pass on to the API');

// ---- silent messages: reactions and edits/deletions get no reply; a poll does
assert.equal(isSilentMessage(by.get('wamid.react')!), true);
assert.equal(isSilentMessage(by.get('wamid.edit')!), true);
assert.equal(isSilentMessage({ kind: 'unsupported', meta: { unsupportedType: 'revoke' } }), true);
assert.equal(isSilentMessage(by.get('wamid.poll')!), false);
assert.equal(isSilentMessage(by.get('wamid.photo')!), false);

// ---- storing keeps the media ID, type and extras; a replay adds nothing
const added = await storeWebhook(db, parsed);
assert.equal(added.length, 10);
assert.equal((await storeWebhook(db, parseWebhook(payload))).length, 0);
assert.equal(row('wamid.photo').media_id, 'M1');
assert.equal(row('wamid.voice').media_mime, 'audio/ogg; codecs=opus');
assert.equal(JSON.parse(row('wamid.doc').meta_json).filename, 'passport.pdf');
assert.equal(row('wamid.btn').media_id, null);

// ---- inline only for known image/audio/video types
for (const t of ['image/jpeg', 'image/webp', 'audio/ogg; codecs=opus', 'audio/mpeg', 'video/mp4']) assert.equal(isInlineMime(t), true, t);
for (const t of ['image/svg+xml', 'text/html', 'application/pdf', 'application/octet-stream', '']) assert.equal(isInlineMime(t), false, t);

// ---- copy to R2: Graph lookup, then the download, both with the token
const store = new Map<string, { buf: ArrayBuffer; type?: string }>();
const r2: any = {
  put: async (k: string, v: ArrayBuffer, o: any) => { store.set(k, { buf: v, type: o?.httpMetadata?.contentType }); },
  get: async (k: string) => (store.has(k) ? { body: new Response(store.get(k)!.buf).body!, httpMetadata: { contentType: store.get(k)!.type } } : null),
  delete: async (keys: string | string[]) => { for (const k of ([] as string[]).concat(keys)) store.delete(k); },
};
const calls: { url: string; auth: string }[] = [];
const sizes: Record<string, number> = { M1: 1000, M2: 1000, M3: 2000, M4: MAX_MEDIA_BYTES + 1 };
const fakeFetch = async (url: string, init?: RequestInit) => {
  calls.push({ url, auth: String((init?.headers as any)?.Authorization ?? '') });
  const lookup = /graph\.facebook\.com\/v[\d.]+\/(M\d)$/.exec(url);
  if (lookup) return new Response(JSON.stringify({ url: `https://lookaside.example/${lookup[1]}`, mime_type: lookup[1] === 'M3' ? 'audio/ogg' : 'image/jpeg', file_size: sizes[lookup[1]] }), { status: 200 });
  if (url.startsWith('https://lookaside.example/')) return new Response(new Uint8Array(8), { status: 200 });
  return new Response('{}', { status: 404 });
};
const env: Record<string, any> = { WHATSAPP_ACCESS_TOKEN: 'wa_token', IMAGES: r2 };
await copyNewMedia(env, db, ['wamid.photo', 'wamid.voice', 'wamid.doc', 'wamid.btn'], fakeFetch);
assert.equal(store.has(mediaKey(row('wamid.photo').id)), true);
assert.equal(store.get(mediaKey(row('wamid.voice').id))!.type, 'audio/ogg');
assert.equal(store.has(mediaKey(row('wamid.doc').id)), false, 'a file over the limit is not copied');
assert.ok(calls.every((c) => c.auth === 'Bearer wa_token'));
assert.equal(calls.filter((c) => c.url.includes('lookaside')).length, 2);
// A failed lookup comes back as an error, never a throw
const failed = await copyMediaToR2(env, r2, { id: 999, media_id: 'GONE' }, fakeFetch);
assert.equal(failed.ok, false);
assert.equal((await copyMediaToR2({}, r2, { id: 999, media_id: 'M1' }, fakeFetch)).error, 'WhatsApp is not configured');

// ---- drafts: no AI key here, so "no_api_key" shows a message reached the draft writer
const draftFor = async (waId: string) => {
  await generateDraft({}, db, by.get(waId)!);
  return raw.prepare(`SELECT needs_person, reason, body FROM wa_drafts WHERE message_id = ?`).get(waId) as any;
};
const voice = await draftFor('wamid.voice');
assert.equal(voice.reason, 'unsupported');
assert.equal(voice.needs_person, 1);
assert.equal(voice.body, 'Thanks for the voice note! A member of our team will check it and reply shortly.');
assert.equal((await draftFor('wamid.photo2')).body, 'Thanks for the photo! A member of our team will check it and reply shortly.');
assert.equal((await draftFor('wamid.loc')).body, 'Thanks for the location! A member of our team will check it and reply shortly.');
assert.match((await draftFor('wamid.poll')).body, /couldn't open it here/);
assert.equal((await draftFor('wamid.photo')).reason, 'no_api_key', 'a captioned photo goes to the draft writer');
assert.equal((await draftFor('wamid.btn')).reason, 'no_api_key', 'a quick-reply button goes to the draft writer');
assert.doesNotMatch(nonTextReply({ kind: 'audio', meta: {} }), /voice note/);

// ---- purge removes the R2 copies with the rows
raw.prepare(`UPDATE wa_messages SET sent_at = '2020-01-01T00:00:00.000Z' WHERE wa_message_id = 'wamid.photo'`).run();
const photoKey = mediaKey(row('wamid.photo').id);
await purgeOld(db, new Date(), false, r2);
assert.equal(store.has(photoKey), false);
assert.equal(row('wamid.photo'), undefined);
assert.equal(store.has(mediaKey(row('wamid.voice').id)), true, 'recent media stays');
assert.equal(await deleteOldMedia(db, undefined, '2030-01-01'), 0);

// ---- deleting one message: its draft and R2 copy go, the chat stays and its time follows the newest message left
const voiceRow = row('wamid.voice');
const voiceKey = mediaKey(voiceRow.id);
assert.equal(store.has(voiceKey), true);
assert.equal(await deleteWaMessage(db, r2, voiceRow.id), '919811122233');
assert.equal(row('wamid.voice'), undefined);
assert.equal(store.has(voiceKey), false);
assert.equal((raw.prepare(`SELECT COUNT(*) AS n FROM wa_drafts WHERE message_id = 'wamid.voice'`).get() as any).n, 0);
assert.ok(raw.prepare(`SELECT 1 FROM wa_conversations WHERE id = '919811122233'`).get(), 'the chat is still there');
assert.equal(await deleteWaMessage(db, r2, voiceRow.id), null, 'already gone');

// ---- deleting a whole chat removes everything; an opted-out chat keeps an empty, nameless row
const left = (raw.prepare(`SELECT COUNT(*) AS n FROM wa_messages WHERE conversation_id = '919811122233'`).get() as any).n;
assert.equal(await deleteWaChat(db, r2, '919811122233'), left);
assert.equal((raw.prepare(`SELECT COUNT(*) AS n FROM wa_messages WHERE conversation_id = '919811122233'`).get() as any).n, 0);
assert.equal((raw.prepare(`SELECT COUNT(*) AS n FROM wa_drafts WHERE conversation_id = '919811122233'`).get() as any).n, 0);
assert.equal(raw.prepare(`SELECT 1 AS x FROM wa_conversations WHERE id = '919811122233'`).get(), undefined);
assert.equal([...store.keys()].length, 0, 'no media left in R2');

const stopped = parseWebhook({ entry: [{ changes: [{ value: { contacts: [{ wa_id: '447700900123', profile: { name: 'Tom' } }], messages: [msg('wamid.stop', 'text', { text: { body: 'STOP' } }, { from: '447700900123' })] } }] }] });
await storeWebhook(db, stopped);
raw.exec(`UPDATE wa_conversations SET state = 'opted_out' WHERE id = '447700900123'`);
await deleteWaChat(db, r2, '447700900123');
const kept = raw.prepare(`SELECT state, profile_name FROM wa_conversations WHERE id = '447700900123'`).get() as any;
assert.deepEqual([kept.state, kept.profile_name], ['opted_out', null], 'the opt-out survives, without the name');
assert.equal((raw.prepare(`SELECT COUNT(*) AS n FROM wa_messages WHERE conversation_id = '447700900123'`).get() as any).n, 0);

console.log('whatsapp media: all checks passed');
