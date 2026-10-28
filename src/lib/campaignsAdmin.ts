import type { D1Like } from './db';

// The pictures on the admin Campaigns list (src/pages/admin/campaigns/index.astro): where each campaign stands, how far its sending has got,
// and whether delivery looks healthy. Counts only; no addresses and no person is read. The delivery and click tables may not exist yet,
// so those numbers fall back to zero rather than failing the page.

export interface CampaignStats {
  queued: number;
  sent: number;
  failed: number;
  skipped: number;
  delivered: number;
  bounced: number;
  complained: number;
  clicks: number;
}

export const emptyStats = (): CampaignStats => ({ queued: 0, sent: 0, failed: 0, skipped: 0, delivered: 0, bounced: 0, complained: 0, clicks: 0 });

/** Sends, delivery events and link clicks for every campaign, in three grouped queries (not one set per campaign). */
export async function loadCampaignStats(db: D1Like): Promise<Map<string, CampaignStats>> {
  const out = new Map<string, CampaignStats>();
  const get = (id: string) => out.get(id) ?? out.set(id, emptyStats()).get(id)!;
  const sends = await db.prepare(`SELECT campaign_id, status, COUNT(*) AS n FROM campaign_sends GROUP BY campaign_id, status`).bind().all<{ campaign_id: string; status: string; n: number }>();
  for (const r of sends.results) if (r.status in emptyStats()) (get(r.campaign_id) as unknown as Record<string, number>)[r.status] = r.n;
  try {
    const events = await db.prepare(`SELECT campaign_id, type, COUNT(DISTINCT resend_id) AS n FROM email_events WHERE campaign_id != '' GROUP BY campaign_id, type`).bind().all<{ campaign_id: string; type: string; n: number }>();
    for (const r of events.results) {
      const s = get(r.campaign_id);
      if (r.type === 'email.delivered') s.delivered = r.n;
      else if (r.type === 'email.bounced') s.bounced = r.n;
      else if (r.type === 'email.complained') s.complained = r.n;
    }
    const clicks = await db
      .prepare(`SELECT l.campaign_id AS campaign_id, COALESCE(SUM(c.clicks), 0) AS n FROM campaign_links l LEFT JOIN campaign_clicks c ON c.code = l.code GROUP BY l.campaign_id`)
      .bind()
      .all<{ campaign_id: string; n: number }>();
    for (const r of clicks.results) get(r.campaign_id).clicks = r.n;
  } catch {
    // the event tables are not created yet: delivery and clicks stay at zero
  }
  return out;
}

/** Percent of the recipients handled (sent, failed or skipped) out of everyone queued for the campaign; 0 with no recipients. */
export function progressPercent(s: CampaignStats): number {
  const total = s.queued + s.sent + s.failed + s.skipped;
  return total === 0 ? 0 : Math.round(((s.sent + s.failed + s.skipped) / total) * 100);
}

/** A rate as a percentage with one decimal; 0 when there is nothing to divide by. */
export function rate(n: number, of: number): number {
  return of <= 0 ? 0 : Math.round((n / of) * 1000) / 10;
}

export type Health = 'none' | 'good' | 'watch' | 'bad';

/** Spam complaints 0.1% and above are a warning (Gmail's hard limit is 0.3%); bounces of 2% or more are a warning, 5% or more a problem. */
export function deliveryHealth(s: CampaignStats): Health {
  if (s.sent === 0) return 'none';
  // Exact ratios by cross-multiplying whole numbers, so 1 complaint in 400 (0.25%) is not rounded up to the 0.3% line.
  if (s.complained * 1000 >= s.sent * 3 || s.bounced * 100 >= s.sent * 5) return 'bad';
  if (s.complained * 1000 >= s.sent || s.bounced * 100 >= s.sent * 2 || s.failed > 0) return 'watch';
  return 'good';
}

export interface CampaignSummary { total: number; draft: number; scheduled: number; sending: number; sent: number; cancelled: number; emailsSent: number; needsLook: number }

/** Counts by status, the emails sent in all, and the campaigns that need a look (a recorded error, failed sends, or delivery that is not healthy). */
export function campaignSummary(rows: { status: string; lastError: string; stats: CampaignStats }[]): CampaignSummary {
  const s: CampaignSummary = { total: rows.length, draft: 0, scheduled: 0, sending: 0, sent: 0, cancelled: 0, emailsSent: 0, needsLook: 0 };
  for (const r of rows) {
    if (r.status === 'draft') s.draft += 1;
    else if (r.status === 'scheduled') s.scheduled += 1;
    else if (r.status === 'sending') s.sending += 1;
    else if (r.status === 'sent') s.sent += 1;
    else if (r.status === 'cancelled') s.cancelled += 1;
    s.emailsSent += r.stats.sent;
    const h = deliveryHealth(r.stats);
    if (r.lastError.trim() !== '' || r.stats.failed > 0 || h === 'watch' || h === 'bad') s.needsLook += 1;
  }
  return s;
}

const ORDER: Record<string, number> = { sending: 0, scheduled: 1, draft: 2, sent: 3, cancelled: 4 };
/** Campaigns that are in motion first, then drafts, then finished ones; newest first inside each group. */
export function sortCampaigns<T extends { status: string; createdAt: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9) || b.createdAt.localeCompare(a.createdAt));
}

/** Bar width in percent: 0 for none, at least 4 so one is visible, 100 for the largest. */
export function barWidth(n: number, max: number): number {
  return n <= 0 || max <= 0 ? 0 : Math.max(4, Math.min(100, Math.round((n / max) * 100)));
}
