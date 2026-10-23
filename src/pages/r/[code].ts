import type { APIRoute } from 'astro';
import { resolveEnv } from '../../lib/env';
import type { D1Like } from '../../lib/db';

export const prerender = false;

// Campaign link redirect. It only ever goes to a URL stored for that code (never one taken from the request), and it
// counts the click per link per day: no person, address or IP is recorded.
export const GET: APIRoute = async ({ params, locals }) => {
  const env = resolveEnv(locals);
  const db: D1Like | undefined = env.DB;
  const code = String(params.code ?? '');
  const home = new Response(null, { status: 302, headers: { Location: 'https://www.iwisglobal.com/', 'Cache-Control': 'no-store' } });
  if (!db || !/^[a-f0-9]{12}$/.test(code)) return home;
  try {
    const link = await db.prepare(`SELECT url FROM campaign_links WHERE code = ?`).bind(code).first<{ url: string }>();
    if (!link) return home;
    await db
      .prepare(`INSERT INTO campaign_clicks (code, day, clicks) VALUES (?, ?, 1) ON CONFLICT (code, day) DO UPDATE SET clicks = clicks + 1`)
      .bind(code, new Date().toISOString().slice(0, 10))
      .run();
    return new Response(null, { status: 302, headers: { Location: link.url, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
  } catch {
    return home;
  }
};
