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

async function uploadImage(r2: R2Like, file: File, folder: string): Promise<UploadResult> {
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new Error('Unsupported image type. Use JPEG, PNG, WebP, or GIF.');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error('Image is too large (max 5MB).');
  }

  const ext = file.type.split('/')[1] === 'jpeg' ? 'jpg' : file.type.split('/')[1];
  const key = `${folder}/${crypto.randomUUID()}.${ext}`;
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

export function uploadBlogImage(r2: R2Like, file: File): Promise<UploadResult> {
  return uploadImage(r2, file, 'blog');
}
