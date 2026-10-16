// Hotelbeds (HBX Group) API client. Server only: it signs every request with
// the account's key and secret. Everything that decides what to send or how to
// read an answer lives in hotelSearch.ts and friends so it can be tested
// without the network.

export interface HbConfig {
  apiKey: string;
  secret: string;
  baseUrl: string;
}

const TEST_URL = 'https://api.test.hotelbeds.com';

export function hbConfig(env: Record<string, any>): HbConfig | null {
  const apiKey = env.HOTELBEDS_API_KEY;
  const secret = env.HOTELBEDS_SECRET;
  if (!apiKey || !secret) return null;
  return { apiKey, secret, baseUrl: String(env.HOTELBEDS_BASE_URL || TEST_URL).replace(/\/+$/, '') };
}

// X-Signature: SHA-256 (hex) of apiKey + secret + the time in whole seconds.
export async function hbSignature(apiKey: string, secret: string, nowSeconds: number): Promise<string> {
  const data = new TextEncoder().encode(`${apiKey}${secret}${nowSeconds}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hbRequest(
  cfg: HbConfig,
  path: string,
  opts: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown; timeoutMs?: number; nowSeconds?: number } = {}
): Promise<{ status: number; json: any }> {
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = {
    'Api-key': cfg.apiKey,
    'X-Signature': await hbSignature(cfg.apiKey, cfg.secret, now),
    Accept: 'application/json',
    'Accept-Encoding': 'gzip',
    'Content-Type': 'application/json',
  };
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

// Rate comments for a BOOKABLE rate that carries a rateCommentsId, from the
// Content API "ratecommentdetails" operation (documented at
// developer.hotelbeds.com/documentation/hotels/content-api/use-rate-comments/):
//   GET /hotel-content-api/1.0/types/ratecommentdetails?code=<rateCommentsId>
//       &date=<check-in>&language=ENG&fields=all&from=1&to=100
// Returns the comment texts exactly as given (HTML is not stripped), [] when
// Hotelbeds has none, and null when the lookup failed or could not be read, so
// the caller can tell "none" from "failed". Never throws.
export async function fetchRateComments(
  cfg: HbConfig,
  rateCommentsId: string,
  checkIn: string,
  hotelCode: number
): Promise<string[] | null> {
  try {
    const query = new URLSearchParams({ code: rateCommentsId, date: checkIn, language: 'ENG', fields: 'all', from: '1', to: '100' });
    const res = await hbRequest(cfg, `/hotel-content-api/1.0/types/ratecommentdetails?${query.toString()}`, { timeoutMs: 10_000 });
    if (res.status !== 200) return null;
    const entries = res.json?.rateComments;
    if (!Array.isArray(entries)) return null;
    const texts: string[] = [];
    const collect = (node: any, depth: number) => {
      if (!node || typeof node !== 'object' || depth > 4) return;
      if (Array.isArray(node)) {
        for (const item of node) collect(item, depth + 1);
        return;
      }
      if (typeof node.description === 'string' && node.description.trim()) texts.push(node.description);
      for (const value of Object.values(node)) if (value && typeof value === 'object') collect(value, depth + 1);
    };
    for (const entry of entries) {
      // Entries for another hotel are skipped when Hotelbeds names the hotel.
      if (entry && typeof entry.hotel === 'number' && entry.hotel !== hotelCode) continue;
      collect(entry, 0);
    }
    // Entries came back but no text could be read from them: treat as failed.
    if (entries.length > 0 && texts.length === 0) return null;
    return texts;
  } catch {
    return null;
  }
}
