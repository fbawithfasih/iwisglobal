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
