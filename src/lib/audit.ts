// Admin audit log: one row per high-impact action (exports, sends, merges, erasures, price and offer
// changes, cancellations, sign-ins). Append-only (schema_audit.sql). Recording never blocks the action it
// describes: if the table is missing or the write fails, the failure is logged and the action goes ahead.
// Rows carry ids and short summaries only, never customer contact details, message text or secrets.
import type { D1Like } from './db';

export type AuditContext = { actor: string; ip: string | null };
export type AuditEntry = {
  action: string; // verb phrase in resource.verb form, e.g. 'lead.export', 'campaign.send'
  resource?: string;
  resourceId?: string;
  summary?: string;
  meta?: Record<string, string | number | boolean | null>;
};
export type AuditRow = {
  id: number;
  at: string;
  actor: string;
  action: string;
  resource: string | null;
  resource_id: string | null;
  summary: string | null;
  ip: string | null;
  meta_json: string | null;
};

const SUMMARY_MAX = 300;
const META_MAX = 1000;

/** Who is acting. Until staff accounts exist this is always the single owner login. */
export function auditContext(request: Request, actor = 'owner'): AuditContext {
  return { actor, ip: request.headers.get('cf-connecting-ip') };
}

const clip = (s: string | undefined, n: number) => (s === undefined ? null : s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Writes one audit row. Returns false (and logs) instead of throwing. */
export async function recordAudit(db: D1Like | undefined, ctx: AuditContext, entry: AuditEntry): Promise<boolean> {
  if (!db) return false;
  try {
    const meta = entry.meta ? JSON.stringify(entry.meta) : undefined;
    await db
      .prepare(`INSERT INTO admin_audit_log (actor, action, resource, resource_id, summary, ip, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(ctx.actor, entry.action, entry.resource ?? null, entry.resourceId ?? null, clip(entry.summary, SUMMARY_MAX), ctx.ip, clip(meta, META_MAX))
      .run();
    return true;
  } catch (err) {
    console.error('audit write failed', entry.action, err instanceof Error ? err.message : 'error');
    return false;
  }
}

export type AuditQuery = { beforeId?: number; action?: string; limit?: number };

/** Newest first, keyset-paged. Throws if the table does not exist yet (the viewer shows a setup note). */
export async function listAudit(db: D1Like, q: AuditQuery = {}): Promise<AuditRow[]> {
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 500);
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q.beforeId) { where.push('id < ?'); binds.push(q.beforeId); }
  if (q.action) { where.push('action = ?'); binds.push(q.action); }
  const { results } = await db
    .prepare(`SELECT id, at, actor, action, resource, resource_id, summary, ip, meta_json FROM admin_audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`)
    .bind(...binds, limit)
    .all<AuditRow>();
  return results;
}

/** Distinct actions seen so far, for the viewer's filter. */
export async function auditActions(db: D1Like): Promise<string[]> {
  const { results } = await db.prepare(`SELECT DISTINCT action FROM admin_audit_log ORDER BY action`).bind().all<{ action: string }>();
  return results.map((r) => r.action);
}
