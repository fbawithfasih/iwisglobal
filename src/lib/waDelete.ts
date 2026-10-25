// Deleting WhatsApp messages and whole chats from the site's own copy
// (/admin/whatsapp, and "Erase this person" on a lead). Removes the message
// rows, their drafts and the R2 copies of photos and voice notes. WhatsApp
// itself is untouched: the guest's phone and the WhatsApp Business app keep
// their copy, because the Cloud API cannot delete messages.
//
// An opted-out chat keeps its conversation row (state 'opted_out'), so a guest
// who wrote STOP is never messaged again just because their chat was deleted.
import type { D1Like } from './db';
import { mediaKey, type MediaBucket } from './waMedia';

async function removeMedia(r2: MediaBucket | undefined, ids: number[]): Promise<void> {
  if (!r2?.delete || !ids.length) return;
  const keys = ids.map(mediaKey);
  for (let i = 0; i < keys.length; i += 500) await r2.delete(keys.slice(i, i + 500));
}

// Drops the conversation row when nothing is left in it, unless it records an opt-out;
// otherwise keeps the list order right by moving last_message_at back to the newest message left.
async function tidyConversation(db: D1Like, conversationId: string): Promise<void> {
  const newest = await db
    .prepare(`SELECT MAX(sent_at) AS at FROM wa_messages WHERE conversation_id = ?`)
    .bind(conversationId)
    .first<{ at: string | null }>();
  if (newest?.at) {
    await db.prepare(`UPDATE wa_conversations SET last_message_at = ? WHERE id = ?`).bind(newest.at, conversationId).run();
  } else {
    await db.prepare(`DELETE FROM wa_conversations WHERE id = ? AND state != 'opted_out'`).bind(conversationId).run();
  }
}

// One message (by wa_messages.id), with its draft and media. Returns the chat it was in, or null if not found.
export async function deleteWaMessage(db: D1Like, r2: MediaBucket | undefined, rowId: number): Promise<string | null> {
  const row = await db
    .prepare(`SELECT id, wa_message_id, conversation_id, media_id FROM wa_messages WHERE id = ?`)
    .bind(rowId)
    .first<{ id: number; wa_message_id: string; conversation_id: string; media_id: string | null }>();
  if (!row) return null;
  if (row.media_id) await removeMedia(r2, [row.id]);
  await db.prepare(`DELETE FROM wa_drafts WHERE message_id = ?`).bind(row.wa_message_id).run();
  await db.prepare(`DELETE FROM wa_messages WHERE id = ?`).bind(row.id).run();
  await tidyConversation(db, row.conversation_id);
  return row.conversation_id;
}

// A whole chat: every message, draft and media file. Returns how many messages went.
export async function deleteWaChat(db: D1Like, r2: MediaBucket | undefined, conversationId: string): Promise<number> {
  const { results } = await db
    .prepare(`SELECT id, media_id FROM wa_messages WHERE conversation_id = ?`)
    .bind(conversationId)
    .all<{ id: number; media_id: string | null }>();
  await removeMedia(r2, results.filter((r) => r.media_id).map((r) => r.id));
  await db.prepare(`DELETE FROM wa_drafts WHERE conversation_id = ?`).bind(conversationId).run();
  await db.prepare(`DELETE FROM wa_messages WHERE conversation_id = ?`).bind(conversationId).run();
  await db
    .prepare(`DELETE FROM wa_conversations WHERE id = ? AND state != 'opted_out'`)
    .bind(conversationId)
    .run();
  // An opted-out chat stays as an empty, nameless record of the opt-out.
  await db.prepare(`UPDATE wa_conversations SET profile_name = NULL WHERE id = ?`).bind(conversationId).run();
  return results.length;
}
