import type { APIRoute } from 'astro';
import { resolveEnv } from '../../../lib/env';
import { isAdminAuthenticated } from '../../../lib/requireAdmin';
import { CHANNEL_LABELS } from '../../../lib/contacts';
import type { D1Like } from '../../../lib/db';
import { STAGE_LABELS, toCsv } from '../../../lib/leadsAdmin';
import { auditContext, recordAudit } from '../../../lib/audit';

export const prerender = false;

// CSV of every lead. The marketing column says whether the person agreed to email marketing, and
// people who unsubscribed, bounced or complained are marked so an export is never used to email
// them. Cells starting with = + - @ are neutralised so a spreadsheet cannot run them.
export const GET: APIRoute = async ({ cookies, locals, request }) => {
  const env = resolveEnv(locals);
  if (!(await isAdminAuthenticated(cookies, env.ADMIN_SESSION_SECRET, locals))) return new Response('Unauthorized', { status: 401 });
  const db: D1Like | undefined = env.DB;
  if (!db) return new Response('No database', { status: 503 });
  const { results } = await db
    .prepare(
      `SELECT l.id, l.name, l.email, l.phone, l.status, l.channel, l.campaign, l.tour_interest, l.travel_start, l.country, l.language, l.score, l.created_at,
              COALESCE(p.marketing_status, 'none') AS marketing_status
         FROM leads l LEFT JOIN people p ON p.id = l.person_id ORDER BY l.created_at DESC LIMIT 20000`
    )
    .bind()
    .all<Record<string, any>>();
  const header = ['id', 'name', 'email', 'phone', 'stage', 'channel', 'campaign', 'tour_interest', 'travel_dates', 'country', 'language', 'score', 'created_at', 'marketing_status', 'ok_to_email_marketing'];
  const rows = results.map((r) => [
    r.id, r.name, r.email, r.phone, STAGE_LABELS[r.status] ?? r.status, CHANNEL_LABELS[r.channel] ?? r.channel, r.campaign, r.tour_interest, r.travel_start, r.country,
    r.language, r.score, r.created_at, r.marketing_status, r.marketing_status === 'subscribed' ? 'yes' : 'no',
  ]);
  await recordAudit(db, auditContext(request, locals), { action: 'lead.export', resource: 'lead', summary: 'Downloaded the full leads CSV', meta: { rows: rows.length } });
  return new Response(toCsv([header, ...rows]), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="iwis-leads-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
};
