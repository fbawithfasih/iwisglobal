import type { APIRoute } from 'astro';
import { resolveEnv } from '../../../../lib/env';
import { isAdminAuthenticated } from '../../../../lib/requireAdmin';
import { contentComplete, getCampaign, loadContent, renderCampaignEmail } from '../../../../lib/campaigns';
import type { D1Like } from '../../../../lib/db';

export const prerender = false;

// Opens the campaign exactly as a reader would see it (with a dummy unsubscribe link). Admin only; nothing is sent.
export const GET: APIRoute = async ({ params, url, cookies, locals }) => {
  const env = resolveEnv(locals);
  if (!(await isAdminAuthenticated(cookies, env.ADMIN_SESSION_SECRET))) return new Response('Unauthorized', { status: 401 });
  const db: D1Like | undefined = env.DB;
  const id = params.id ?? '';
  if (!db || !id || !(await getCampaign(db, id))) return new Response('Not found', { status: 404 });
  const content = await loadContent(db, id);
  const lang = url.searchParams.get('lang') ?? 'en';
  const c = content[lang] ?? content.en;
  if (!contentComplete(c)) return new Response('<p style="font-family:sans-serif">This version needs a subject, a headline and an intro first.</p>', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  const r = await renderCampaignEmail(db, id, c, { language: c.language, country: url.searchParams.get('country') ?? '', unsubscribeLink: 'https://www.iwisglobal.com/unsubscribe/preview' });
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Preview</title><body style="margin:0;padding:24px;background:#f5f5f4">${r.html}`, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
};
