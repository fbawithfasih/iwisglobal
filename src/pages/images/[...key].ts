import type { APIRoute } from 'astro';
import { resolveEnv } from '../../lib/env';

export const prerender = false;

// Only images written by src/lib/images.ts (as `<folder>/<uuid>.<ext>`) are
// servable here — the IMAGES bucket binding is otherwise a raw key-value
// store, and without this allow-list this route would serve back ANY
// object ever put into that bucket, not just the ones this app
// intentionally made public.
const ALLOWED_KEY_PREFIXES = ['tours/', 'agra-highlights/'];

export const GET: APIRoute = async ({ params, locals }) => {
  const key = params.key;
  if (!key || !ALLOWED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    return new Response('Not found', { status: 404 });
  }

  const env = resolveEnv(locals);
  const r2 = env.IMAGES;
  if (!r2) return new Response('Image storage not configured', { status: 500 });

  const object = await r2.get(key);
  if (!object) return new Response('Not found', { status: 404 });

  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};
