import type { APIRoute } from 'astro';
import { resolveEnv } from '../../../lib/env';
import { viewCounts, waitingTooLong } from '../../../lib/leadsAdmin';
import { sendHotelAlertEmail } from '../../../lib/email';
import { sendAdminPush } from '../../../lib/webPush';
import type { D1Like } from '../../../lib/db';

export const prerender = false;

// Morning summary (09:00 India), called by .github/workflows/leads-digest.yml with a shared secret.
// Says nothing when there is nothing to do.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = resolveEnv(locals);
  const db: D1Like | undefined = env.DB;
  if (!env.LEADS_CRON_SECRET || request.headers.get('authorization') !== `Bearer ${env.LEADS_CRON_SECRET}` || !db) {
    return new Response('Not found', { status: 404 });
  }
  const counts = await viewCounts(db);
  const waiting = await waitingTooLong(db);
  const lines = [
    waiting > 0 && `${waiting} new lead${waiting === 1 ? '' : 's'} still waiting for a first reply`,
    counts.followups > 0 && `${counts.followups} follow-up${counts.followups === 1 ? '' : 's'} due`,
    counts.quotes > 0 && `${counts.quotes} quote${counts.quotes === 1 ? '' : 's'} awaiting a reply`,
    counts.stale > 0 && `${counts.stale} open lead${counts.stale === 1 ? '' : 's'} with no activity for 7 days`,
  ].filter(Boolean) as string[];
  if (lines.length > 0) {
    await sendHotelAlertEmail(env, 'Leads to look at today', [...lines, '', 'Open: https://www.iwisglobal.com/admin/leads'].join('\n'), 'Leads to look at today');
    await sendAdminPush(env, db, { title: 'Leads to look at today', body: lines[0], url: '/admin/leads', tag: 'leads-digest' });
  }
  return new Response(JSON.stringify({ sent: lines.length > 0, lines: lines.length }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
