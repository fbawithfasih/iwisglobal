import type { APIRoute } from 'astro';
import { resolveEnv } from '../../../../../lib/env';
import { isAdminAuthenticated } from '../../../../../lib/requireAdmin';
import type { D1Like } from '../../../../../lib/db';
import { copyMediaToR2, isInlineMime, mediaKey, type MediaBucket } from '../../../../../lib/waMedia';

export const prerender = false;

// A guest's photo, voice note, video or document for /admin/whatsapp, from the
// R2 copy (src/lib/waMedia.ts), fetched from Meta first if the copy is missing.
// Admin login only. Only known image, audio and video types are shown inline;
// everything else is a download, and the sandbox CSP stops any file from
// running as a page on this domain.
export const GET: APIRoute = async ({ params, url, locals, cookies }) => {
  const env = resolveEnv(locals);
  if (!(await isAdminAuthenticated(cookies, env.ADMIN_SESSION_SECRET, locals))) return new Response('Unauthorized', { status: 401 });
  const db = env.DB as D1Like | undefined;
  const r2 = env.IMAGES as MediaBucket | undefined;
  const id = Number(params.id);
  if (!db || !r2 || !Number.isInteger(id) || id <= 0) return new Response('Not found', { status: 404 });

  const row = await db
    .prepare(`SELECT id, media_id, media_mime, meta_json FROM wa_messages WHERE id = ? AND media_id IS NOT NULL`)
    .bind(id)
    .first<{ id: number; media_id: string; media_mime: string | null; meta_json: string | null }>();
  if (!row) return new Response('Not found', { status: 404 });

  let object = await r2.get(mediaKey(row.id));
  if (!object) {
    const copied = await copyMediaToR2(env, r2, row);
    if (!copied.ok) return new Response(`Could not load this file from WhatsApp (${copied.error}). Open the chat in the WhatsApp Business app.`, { status: 502 });
    object = await r2.get(mediaKey(row.id));
    if (!object) return new Response('Not found', { status: 404 });
  }

  const mime = object.httpMetadata?.contentType || row.media_mime || 'application/octet-stream';
  let filename = '';
  try {
    filename = String(JSON.parse(row.meta_json ?? '{}')?.filename ?? '');
  } catch {
    filename = '';
  }
  const safeName = (filename || `whatsapp-${row.id}`).replace(/[^\w.\- ]+/g, '_').slice(0, 120);
  const inline = isInlineMime(mime) && url.searchParams.get('download') !== '1';
  return new Response(object.body, {
    headers: {
      'Content-Type': inline ? mime : 'application/octet-stream',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${safeName}"`,
      'Content-Security-Policy': "sandbox; default-src 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=3600',
    },
  });
};
