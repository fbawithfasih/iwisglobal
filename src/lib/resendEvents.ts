import type { D1Like } from './db';
import { suppress } from './contacts';

// Resend webhooks (delivered, bounced, complained ...), signed with Svix. A permanent bounce or a spam complaint
// suppresses the address for good; every event is stored once (svix_id) so retries change nothing.

const TOLERANCE_SECONDS = 5 * 60;

const b64ToBytes = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const bytesToB64 = (bytes: ArrayBuffer): string => btoa(String.fromCharCode(...new Uint8Array(bytes)));

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Svix: sign "<id>.<timestamp>.<body>" with HMAC-SHA256 using the base64 part of the whsec_ secret; the header holds
// one or more space-separated "v1,<base64>" signatures.
export async function verifySvix(secret: string, headers: { id: string; timestamp: string; signature: string }, body: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!secret || !headers.id || !headers.timestamp || !headers.signature) return false;
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > TOLERANCE_SECONDS) return false;
  try {
    const key = await crypto.subtle.importKey('raw', b64ToBytes(secret.replace(/^whsec_/, '')) as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const expected = bytesToB64(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${headers.id}.${headers.timestamp}.${body}`)));
    return headers.signature.split(' ').some((part) => {
      const [version, sig] = part.split(',');
      return version === 'v1' && !!sig && sameString(sig, expected);
    });
  } catch {
    return false;
  }
}

export interface EventResult {
  status: 'stored' | 'duplicate' | 'ignored';
  action?: 'hard_bounce' | 'complaint';
}

// Handles one verified event. Throws on a database failure so the webhook answers 5xx and Resend retries.
export async function handleResendEvent(db: D1Like, svixId: string, body: string): Promise<EventResult> {
  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return { status: 'ignored' };
  }
  const type = typeof event?.type === 'string' ? event.type : '';
  if (!type.startsWith('email.')) return { status: 'ignored' };
  const data = event.data ?? {};
  const resendId = typeof data.email_id === 'string' ? data.email_id : '';
  const stamp = new Date().toISOString();

  const sent = resendId ? await db.prepare(`SELECT campaign_id FROM campaign_sends WHERE resend_id = ? LIMIT 1`).bind(resendId).first<{ campaign_id: string }>() : null;
  const bounceType = String(data.bounce?.type ?? '').toLowerCase();
  const detail = type === 'email.bounced' ? `${bounceType} ${String(data.bounce?.subType ?? '')}`.trim().slice(0, 120) : '';

  // Store first: INSERT OR IGNORE tells us whether this delivery was already handled.
  const ins = await db
    .prepare(`INSERT OR IGNORE INTO email_events (svix_id, type, resend_id, campaign_id, detail, occurred_at, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(svixId, type, resendId, sent?.campaign_id ?? '', detail, typeof event.created_at === 'string' ? event.created_at : stamp, stamp)
    .run();
  if ((ins.meta?.changes ?? 0) === 0) return { status: 'duplicate' };

  const to = Array.isArray(data.to) ? data.to : [];
  try {
    if (type === 'email.complained') {
      for (const a of to) await suppress(db, 'email', String(a), 'complaint');
      return { status: 'stored', action: 'complaint' };
    }
    // Only a permanent bounce means the address is dead; "transient" ones (full mailbox ...) are retried by the provider.
    if (type === 'email.bounced' && bounceType === 'permanent') {
      for (const a of to) await suppress(db, 'email', String(a), 'hard_bounce');
      return { status: 'stored', action: 'hard_bounce' };
    }
  } catch (err) {
    await db.prepare(`DELETE FROM email_events WHERE svix_id = ?`).bind(svixId).run();
    throw err;
  }
  return { status: 'stored' };
}

export interface DeliveryStats {
  delivered: number;
  bounced: number;
  complained: number;
  delayed: number;
}

export async function deliveryStats(db: D1Like, campaignId: string): Promise<DeliveryStats> {
  const rows = (
    await db.prepare(`SELECT type, COUNT(DISTINCT resend_id) AS n FROM email_events WHERE campaign_id = ? GROUP BY type`).bind(campaignId).all<{ type: string; n: number }>()
  ).results;
  const n = (t: string) => rows.find((r) => r.type === t)?.n ?? 0;
  return { delivered: n('email.delivered'), bounced: n('email.bounced'), complained: n('email.complained'), delayed: n('email.delivery_delayed') };
}

// People who were sent this campaign and have unsubscribed since (the unsubscribe link carries no campaign id).
export async function unsubscribedSince(db: D1Like, campaignId: string): Promise<number> {
  const r = await db
    .prepare(`SELECT COUNT(*) AS n FROM campaign_sends s JOIN people p ON p.id = s.person_id WHERE s.campaign_id = ? AND s.status = 'sent' AND p.marketing_status = 'unsubscribed'`)
    .bind(campaignId)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

export async function clickStats(db: D1Like, campaignId: string): Promise<{ url: string; clicks: number }[]> {
  return (
    await db
      .prepare(
        `SELECT l.url AS url, COALESCE(SUM(c.clicks), 0) AS clicks FROM campaign_links l LEFT JOIN campaign_clicks c ON c.code = l.code WHERE l.campaign_id = ? GROUP BY l.code ORDER BY clicks DESC`
      )
      .bind(campaignId)
      .all<{ url: string; clicks: number }>()
  ).results;
}
