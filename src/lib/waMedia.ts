// Photos, voice notes, videos, documents and stickers sent on WhatsApp.
// Meta's webhook carries only a media ID; the file is fetched with the
// WhatsApp token (GET /{media-id} gives a short-lived URL, which needs the same
// token) and copied to R2 under wa-media/<wa_messages.id>, because Meta keeps
// media for 30 days only. The copy is made right after the webhook, and again
// on first view in the admin if that failed. Nothing under wa-media/ is public:
// src/pages/images/[...key].ts does not serve it, only
// src/pages/admin/api/whatsapp/media/[id].ts does, behind the admin login.
import type { D1Like } from './db';
import { GRAPH_API_VERSION } from './whatsapp';

export interface MediaBucket {
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null>;
  delete?(keys: string | string[]): Promise<unknown>;
}

// WhatsApp's own limits are 16 MB for audio and video and 100 MB for
// documents; anything over this stays a "download from WhatsApp" note.
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

export const mediaKey = (rowId: number): string => `wa-media/${rowId}`;

// Types the admin may show inline. Everything else (HTML, SVG, PDF, Office
// files...) is served as a download, so a guest's file can never run as a page
// on our own domain.
const INLINE = /^(image\/(jpeg|png|webp|gif)|audio\/(ogg|mpeg|mp4|aac|amr|opus)|video\/(mp4|3gpp))(;|$)/i;
export const isInlineMime = (mime: string): boolean => INLINE.test(mime.trim());

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

// Copies one message's media to R2. Returns true when the file is in R2
// (already, or now). Never throws.
export async function copyMediaToR2(
  env: Record<string, any>,
  r2: MediaBucket,
  row: { id: number; media_id: string },
  fetchFn: FetchLike = fetch
): Promise<{ ok: boolean; mime?: string; error?: string }> {
  const token = env.WHATSAPP_ACCESS_TOKEN;
  if (!token) return { ok: false, error: 'WhatsApp is not configured' };
  try {
    const info = await fetchFn(`https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(row.media_id)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data: any = await info.json().catch(() => ({}));
    if (!info.ok || !data?.url) return { ok: false, error: String(data?.error?.message ?? `media lookup HTTP ${info.status}`).slice(0, 200) };
    if (Number(data.file_size) > MAX_MEDIA_BYTES) return { ok: false, error: 'file too large to copy' };
    const file = await fetchFn(String(data.url), { headers: { Authorization: `Bearer ${token}` } });
    if (!file.ok) return { ok: false, error: `media download HTTP ${file.status}` };
    const buf = await file.arrayBuffer();
    if (buf.byteLength > MAX_MEDIA_BYTES) return { ok: false, error: 'file too large to copy' };
    const mime = String(data.mime_type || file.headers.get('content-type') || 'application/octet-stream').slice(0, 100);
    await r2.put(mediaKey(row.id), buf, { httpMetadata: { contentType: mime } });
    return { ok: true, mime };
  } catch (err) {
    console.error('whatsapp media: copy failed', err instanceof Error ? err.message : 'error');
    return { ok: false, error: 'network error' };
  }
}

// After a webhook: copy the media of the messages just stored. One failure
// does not stop the others; the admin retries on first view.
export async function copyNewMedia(env: Record<string, any>, db: D1Like, waMessageIds: string[], fetchFn: FetchLike = fetch): Promise<void> {
  const r2: MediaBucket | undefined = env.IMAGES;
  if (!r2 || !waMessageIds.length) return;
  for (const waId of waMessageIds) {
    const row = await db
      .prepare(`SELECT id, media_id FROM wa_messages WHERE wa_message_id = ? AND media_id IS NOT NULL`)
      .bind(waId)
      .first<{ id: number; media_id: string }>();
    if (row) await copyMediaToR2(env, r2, row, fetchFn);
  }
}

// Removes the R2 copies of messages older than the retention cutoff, before
// those rows are deleted (src/lib/waLearning.ts purgeOld).
export async function deleteOldMedia(db: D1Like, r2: MediaBucket | undefined, cutoff: string): Promise<number> {
  if (!r2?.delete) return 0;
  const { results } = await db
    .prepare(`SELECT id FROM wa_messages WHERE sent_at < ? AND media_id IS NOT NULL`)
    .bind(cutoff)
    .all<{ id: number }>();
  const keys = results.map((r) => mediaKey(r.id));
  for (let i = 0; i < keys.length; i += 500) await r2.delete(keys.slice(i, i + 500));
  return keys.length;
}
