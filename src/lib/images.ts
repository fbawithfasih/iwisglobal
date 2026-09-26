// Uploads tour images to R2 (binding IMAGES, see wrangler.toml) and serves
// them back through src/pages/images/[...key].ts — keeps everything within
// this Cloudflare Pages project rather than depending on R2's public dev
// domain being enabled.

export interface R2Like {
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{
    body: ReadableStream;
    httpMetadata?: { contentType?: string };
  } | null>;
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export interface UploadResult {
  url: string;
}

async function uploadImage(r2: R2Like, file: File, folder: string, name: string = crypto.randomUUID()): Promise<UploadResult> {
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new Error('Unsupported image type. Use JPEG, PNG, WebP, or GIF.');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error('Image is too large (max 5MB).');
  }

  const ext = file.type.split('/')[1] === 'jpeg' ? 'jpg' : file.type.split('/')[1];
  const key = `${folder}/${name}.${ext}`;
  const buffer = await file.arrayBuffer();

  await r2.put(key, buffer, { httpMetadata: { contentType: file.type } });

  return { url: `/images/${key}` };
}

export function uploadTourImage(r2: R2Like, file: File): Promise<UploadResult> {
  return uploadImage(r2, file, 'tours');
}

export function uploadAgraHighlightImage(r2: R2Like, file: File): Promise<UploadResult> {
  return uploadImage(r2, file, 'agra-highlights');
}

// The cover plus, when the admin form's browser optimizer made one, its
// 800px copy for the /blog list (stored beside it as <uuid>-800.<ext>).
export async function uploadBlogImage(
  r2: R2Like,
  file: File,
  thumb?: File | null
): Promise<UploadResult & { thumbUrl: string }> {
  const name = crypto.randomUUID();
  const { url } = await uploadImage(r2, file, 'blog', name);
  const thumbUrl = thumb && thumb.size > 0 ? (await uploadImage(r2, thumb, 'blog', `${name}-800`)).url : '';
  return { url, thumbUrl };
}

// E-tickets bought on ASI's site, uploaded from the admin booking page.
// Stored under tickets/, which src/pages/images/[...key].ts does NOT serve —
// they contain visitor details, so they're only downloadable through the
// admin-authenticated /admin/bookings/[id]/ticket route.
const TICKET_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export async function uploadTicketFile(r2: R2Like, file: File): Promise<{ key: string }> {
  const ext = TICKET_TYPES[file.type];
  if (!ext) throw new Error('Unsupported file type. Upload the e-ticket as a PDF, JPEG, PNG, or WebP.');
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('File is too large (max 5MB).');
  const key = `tickets/${crypto.randomUUID()}.${ext}`;
  await r2.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  return { key };
}
