// Serve a D1-built public text file from Cloudflare's edge cache, refreshing
// it in the background (stale-while-revalidate). For files that must answer
// fast whether or not the cache is warm for that data centre, e.g. llms.txt:
// Lighthouse's Agentic Browsing audit gives it 2 s, and building it means a
// round trip to the database in North America.
import type { APIContext } from 'astro';

const FRESH_FOR_MS = 60 * 60 * 1000; // rebuild in the background after 1 hour
const KEEP_FOR_S = 7 * 24 * 60 * 60; // serve stale for up to a week meanwhile
const BUILT_AT = 'X-Built-At';

type Runtime = { caches?: { default: Cache }; ctx?: { waitUntil(p: Promise<unknown>): void } };

export async function edgeCached(context: APIContext, build: () => Promise<Response>): Promise<Response> {
  const runtime = (context.locals as { runtime?: Runtime }).runtime;
  const cache = runtime?.caches?.default;
  if (!cache) return build(); // astro dev / preview without the Workers runtime

  const key = new Request(new URL(context.url.pathname, context.url.origin).toString());
  const store = async () => {
    const fresh = await build();
    if (!fresh.ok) return fresh;
    const stored = new Response(fresh.body, fresh);
    stored.headers.set('Cache-Control', `public, max-age=${KEEP_FOR_S}`);
    stored.headers.set(BUILT_AT, String(Date.now()));
    await cache.put(key, stored.clone());
    return stored;
  };

  const hit = await cache.match(key);
  let response: Response;
  if (hit) {
    if (Date.now() - Number(hit.headers.get(BUILT_AT) ?? 0) > FRESH_FOR_MS) {
      const refresh = store().catch(() => undefined);
      if (runtime?.ctx) runtime.ctx.waitUntil(refresh);
    }
    response = new Response(hit.body, hit);
  } else {
    response = await store();
  }
  // Browsers/crawlers: an hour is plenty; the edge copy is what's kept longer.
  response.headers.set('Cache-Control', 'public, max-age=3600');
  response.headers.delete(BUILT_AT);
  return response;
}
