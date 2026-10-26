import type { APIRoute } from 'astro';
import { resolveEnv } from '../../../lib/env';
import { isAdminAuthenticated } from '../../../lib/requireAdmin';
import { exportTestCases } from '../../../lib/waLaunch';
import type { D1Like } from '../../../lib/db';

export const prerender = false;

// Reviewed WhatsApp drafts as evaluation cases (redacted), for
// scripts/wa-eval/real-questions.json. Admin only: the guest questions come from
// real chats, so they are redacted before they leave the database.
export const GET: APIRoute = async ({ cookies, locals, redirect }) => {
  const env = resolveEnv(locals);
  if (!(await isAdminAuthenticated(cookies, env.ADMIN_SESSION_SECRET, locals))) return redirect('/admin/login');
  const db = env.DB as D1Like | undefined;
  const cases = db ? await exportTestCases(db) : [];
  return new Response(JSON.stringify(cases, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="real-questions.json"',
      'Cache-Control': 'no-store',
    },
  });
};
