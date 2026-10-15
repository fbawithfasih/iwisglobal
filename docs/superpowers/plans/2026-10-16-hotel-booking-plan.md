# Agra Hotel Booking (Hotelbeds) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guests search Agra hotels via Hotelbeds on iwisglobal.com, pay online, and get a voucher; the custom-tour builder offers the same booking.

**Architecture:** A server-only Hotelbeds client (signed, gzip) plus pure modules for search building, parsing, pricing and refund maths. Content for Agra hotels is mirrored into D1. Booking follows the existing trust model: the server prices and stores the quote, Razorpay collects the full amount, an atomic status claim books with Hotelbeds, and any failure refunds in full.

**Tech Stack:** Astro 4 hybrid on Cloudflare Pages + D1, React islands, Razorpay, Resend, Hotelbeds Booking/Content APIs. Tests: esbuild bundle + node scripts against in-memory `node:sqlite` with stubbed `fetch` (no framework).

**Spec:** `docs/superpowers/specs/2026-10-16-hotel-booking-design.md`

## Global Constraints

- Commands run from the repo root `/Users/fasihuddinahmer/Projects/iwisglobal` (the app is the repo root here).
- `npx astro check` must report 0 errors in `src/`; `npm run build` must pass (build does not type-check).
- Hotelbeds workflow is fixed: one Availability call (all rooms, all hotels, max 2000 hotels), CheckRate only when `rateType === 'RECHECK'` (max 10 rates per call), then Booking. Never repeat Availability.
- Booking call timeout is at least 60 seconds (use 70 000 ms). Requests send `Accept-Encoding: gzip`.
- Children's ages are always sent when children are included.
- Secrets only as Cloudflare secrets: `HOTELBEDS_API_KEY`, `HOTELBEDS_SECRET`, `HOTELBEDS_BASE_URL`, `HOTEL_SYNC_SECRET`. Never in code, commits or chat.
- Prices, amounts charged and refunds are computed on the server; browser values are ignored.
- Money is whole rupees or dollars in tables (like `custom_trips`); Razorpay amounts are minor units (×100).
- Opaque/packaged rates (`packaging === true`) are never shown.
- Voucher shows no price and carries the exact line: `Payable through <supplier name>, acting as agent for the service operating company, details of which can be provided upon request. VAT: <supplier VAT> Reference: <booking reference>`.
- Guests see the hotel pages only when the admin switch is on; guests get a 404 otherwise, admins see a preview banner.
- Guest text in `en/es/fr/de` in `src/i18n/*.ts` (`en` defines the shape; `fmt()` placeholders `{name}`).
- Commits: no attribution lines. Do not push or change production data without the owner's yes.
- Env keys must be added to `resolveEnv` in `src/lib/env.ts` (dual lookup) before use.

## Review Focus

1. Search with children but no ages, or ages outside 0–17: rejected with a clear message and never sent to Hotelbeds (Task 5 tests).
2. Rate sold out or price changed between search and CheckRate: guest sees the new price and must confirm again; nothing is charged at the old figure (Task 9 tests).
3. Hotelbeds booking call times out or errors after the guest paid: reconcile by client reference before deciding; if not booked, full refund; never double-book on retry (Task 11 tests).
4. Verify and webhook both arriving, or the guest double-clicking Pay: exactly one Hotelbeds booking and one set of emails (Task 11 tests).
5. Cancelling after the free-cancellation deadline: refund equals sell price minus the proportional cancellation fee, never negative, never above what was paid (Tasks 4 and 14 tests).

**Test harness (applies to every scratchpad test in this plan):** tests live in the session scratchpad, not in the repo. Bundle with `npx esbuild <file>.ts --bundle --platform=node --format=esm --outfile=<file>.mjs --log-level=error --external:node:sqlite`; if the bundle contains `import.meta.glob`, run `sed -i.bak 's|^var bundled = import.meta.glob.*|var bundled = {};|' <file>.mjs`; run `NODE_PATH=$PWD/node_modules node --no-warnings <file>.mjs`. In-memory DB setup: copy the first 20 lines of `pay-test.ts` in the scratchpad (it loads every `schema*.sql` three times into `node:sqlite` and wraps it as `D1Like`; `.bind()` is required before `.run/.first/.all`).

---

## Milestone 1 — Client, content, search, admin settings

### Task 1: Hotelbeds client (signing, config, fetch)

**Files:**
- Create: `src/lib/hotelbeds.ts`
- Modify: `src/lib/env.ts` (add four keys), `.env.example`
- Test: scratchpad `hb-client-test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface HbConfig { apiKey: string; secret: string; baseUrl: string }
  export function hbConfig(env: Record<string, any>): HbConfig | null
  export async function hbSignature(apiKey: string, secret: string, nowSeconds: number): Promise<string>
  export async function hbRequest(cfg: HbConfig, path: string, opts?: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown; timeoutMs?: number; nowSeconds?: number }): Promise<{ status: number; json: any }>
  ```

- [ ] **Step 1: Write the failing test** (`hb-client-test.ts`)

```ts
import { hbSignature, hbRequest, hbConfig } from '/Users/fasihuddinahmer/Projects/iwisglobal/src/lib/hotelbeds';
import { createHash } from 'node:crypto';
let failed = 0;
const ok = (c: boolean, m: string) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) failed++; };

const expected = createHash('sha256').update('KEY' + 'SEC' + '1700000000').digest('hex');
ok((await hbSignature('KEY', 'SEC', 1700000000)) === expected, 'signature is sha256(key+secret+seconds)');
ok(hbConfig({}) === null, 'no config without keys');
ok(hbConfig({ HOTELBEDS_API_KEY: 'k', HOTELBEDS_SECRET: 's' })?.baseUrl === 'https://api.test.hotelbeds.com', 'defaults to the test environment');
ok(hbConfig({ HOTELBEDS_API_KEY: 'k', HOTELBEDS_SECRET: 's', HOTELBEDS_BASE_URL: 'https://api.hotelbeds.com/' })?.baseUrl === 'https://api.hotelbeds.com', 'trims trailing slash');

let seen: any;
globalThis.fetch = (async (url: any, init: any) => { seen = { url: String(url), init }; return new Response(JSON.stringify({ hello: 1 }), { status: 200 }); }) as any;
const cfg = { apiKey: 'KEY', secret: 'SEC', baseUrl: 'https://api.test.hotelbeds.com' };
const r = await hbRequest(cfg, '/hotel-api/1.0/hotels', { method: 'POST', body: { a: 1 }, nowSeconds: 1700000000 });
ok(r.status === 200 && r.json.hello === 1, 'returns status and json');
ok(seen.url === 'https://api.test.hotelbeds.com/hotel-api/1.0/hotels', 'builds the url');
ok(seen.init.headers['Api-key'] === 'KEY' && seen.init.headers['X-Signature'] === expected, 'sends key and signature');
ok(seen.init.headers['Accept-Encoding'] === 'gzip' && seen.init.headers['Content-Type'] === 'application/json', 'gzip and json headers');
ok(seen.init.body === '{"a":1}', 'posts the body as json');
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run to verify it fails**

Run: `S=/private/tmp/claude-501/-Users-fasihuddinahmer-Projects-iwisglobal/01269fc9-1662-478f-a3ce-7162e52545ed/scratchpad; npx esbuild $S/hb-client-test.ts --bundle --platform=node --format=esm --outfile=$S/hb-client-test.mjs --log-level=error && node --no-warnings $S/hb-client-test.mjs`
Expected: esbuild error "Could not resolve .../hotelbeds".

- [ ] **Step 3: Implement** `src/lib/hotelbeds.ts`

```ts
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
```

- [ ] **Step 4: Add env keys.** In `src/lib/env.ts`, inside the returned object add:

```ts
    HOTELBEDS_API_KEY: runtimeEnv.HOTELBEDS_API_KEY ?? import.meta.env.HOTELBEDS_API_KEY,
    HOTELBEDS_SECRET: runtimeEnv.HOTELBEDS_SECRET ?? import.meta.env.HOTELBEDS_SECRET,
    HOTELBEDS_BASE_URL: runtimeEnv.HOTELBEDS_BASE_URL ?? import.meta.env.HOTELBEDS_BASE_URL,
    HOTEL_SYNC_SECRET: runtimeEnv.HOTEL_SYNC_SECRET ?? import.meta.env.HOTEL_SYNC_SECRET,
```
Append the four names (empty values) with a one-line comment each to `.env.example`.

- [ ] **Step 5: Run tests** (same command as Step 2). Expected: all `ok`, exit 0. Then `npx astro check 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^src/.*error|- [0-9]+ error"` → `0 errors`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/hotelbeds.ts src/lib/env.ts .env.example
git commit -m "Hotels: Hotelbeds client with request signing"
```

---

### Task 2: Probe the test key (discovery; no secrets committed)

**Files:**
- Create: scratchpad `hb-probe.mjs` (not committed)

**Interfaces:** Consumes `hbRequest`, `hbConfig`. Produces: confirmed facts (Agra destination code, contract currency) and a real availability response saved to `scratchpad/hb-avail.json`, used as the fixture in Task 5.

- [ ] **Step 1:** The owner puts the test key and secret in their own shell (never in chat): `export HOTELBEDS_API_KEY=… HOTELBEDS_SECRET=…`.
- [ ] **Step 2:** Run a probe that prints (a) the India destinations (`GET /hotel-content-api/1.0/locations/destinations?fields=all&countryCodes=IN&from=1&to=1000&language=ENG`) to find the Agra code, (b) 3 hotels of that destination (`GET /hotel-content-api/1.0/hotels?destinationCode=<code>&fields=all&from=1&to=3&language=ENG`), (c) one availability response for 2 adults, check-in 60 days ahead, 1 night, for those hotel codes (`POST /hotel-api/1.0/hotels` with body `{stay:{checkIn,checkOut},occupancies:[{rooms:1,adults:2,children:0}],hotels:{hotel:[codes]}}`). Print status codes, the hotel `currency`, and the keys of one `rates[0]`.
- [ ] **Step 3:** Save the availability JSON to `scratchpad/hb-avail.json`. If any field name differs from what Tasks 5, 9, 11 use, fix those tasks' code before implementing them.
- [ ] **Step 4:** Update the spec's "Open items" currency line with the answer and record the destination code; commit docs only: `git commit -am "Hotels: record Hotelbeds destination code and currency"`.

---

### Task 3: Schema and settings data layer

**Files:**
- Create: `schema_hotels.sql`, `src/lib/hotelData.ts`
- Test: scratchpad `hotel-data-test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface HotelSettings { enabled: boolean; markupPercent: number; fxEurInr: number; fxEurUsd: number; contractCurrency: string; destinationCode: string; minStars: number; excludedCodes: number[] }
  export async function loadHotelSettings(db: D1Like): Promise<HotelSettings>
  export async function saveHotelSettings(db: D1Like, input: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string }>
  export async function isHotelsEnabled(db: D1Like): Promise<boolean>
  export async function setHotelsEnabled(db: D1Like, on: boolean): Promise<{ ok: true } | { ok: false; error: string }>
  ```

- [ ] **Step 1: Write `schema_hotels.sql`**

```sql
-- Agra hotel booking (Hotelbeds). Run once:
--   wrangler d1 execute iwisglobal-bookings --remote --file=schema_hotels.sql
CREATE TABLE IF NOT EXISTS hotel_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO hotel_settings (key, value) VALUES
  ('enabled', '0'), ('markup_percent', '0'), ('fx_eur_inr', '0'), ('fx_eur_usd', '0'),
  ('contract_currency', 'EUR'), ('destination_code', 'AGR'), ('min_stars', '0'), ('excluded_codes', '');

CREATE TABLE IF NOT EXISTS hotel_content (
  code INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category_code TEXT NOT NULL DEFAULT '',
  category_name TEXT NOT NULL DEFAULT '',
  stars INTEGER NOT NULL DEFAULT 0,
  address TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  lat REAL, lon REAL,
  description TEXT NOT NULL DEFAULT '',
  images_json TEXT NOT NULL DEFAULT '[]',
  facilities_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hotel_sync (id INTEGER PRIMARY KEY CHECK (id = 1), last_run TEXT, last_count INTEGER, last_error TEXT);
INSERT OR IGNORE INTO hotel_sync (id) VALUES (1);

CREATE TABLE IF NOT EXISTS hotel_bookings (
  id TEXT PRIMARY KEY,                       -- hb_<uuid>; also the Hotelbeds clientReference
  status TEXT NOT NULL,                      -- quoted | paid | booked | failed | cancelled
  currency TEXT NOT NULL,                    -- INR | USD (what the guest pays)
  hotel_code INTEGER NOT NULL,
  search_json TEXT NOT NULL,
  selected_json TEXT NOT NULL,               -- chosen rate, price and cancellation as of CheckRate
  net_cost REAL NOT NULL,                    -- Hotelbeds net, contract currency
  sell_total INTEGER NOT NULL,               -- guest price, whole currency units
  order_id TEXT NOT NULL DEFAULT '',
  payment_id TEXT NOT NULL DEFAULT '',
  hb_reference TEXT NOT NULL DEFAULT '',
  holder_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  guests_json TEXT NOT NULL DEFAULT '[]',
  supplier_json TEXT NOT NULL DEFAULT '{}',  -- supplier name and VAT from the booking response
  locale TEXT NOT NULL DEFAULT 'en',
  custom_trip_id TEXT NOT NULL DEFAULT '',
  refunded INTEGER NOT NULL DEFAULT 0,       -- whole currency units refunded
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hotel_bookings_order ON hotel_bookings (order_id);
CREATE INDEX IF NOT EXISTS idx_hotel_bookings_status ON hotel_bookings (status, created_at);

-- Shown rates kept for 30 minutes so the server, not the browser, supplies
-- net price and cancellation terms when a guest picks one.
CREATE TABLE IF NOT EXISTS hotel_rate_cache (
  rate_key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
```

- [ ] **Step 2: Failing test** (`hotel-data-test.ts`): load the schemas; assert `loadHotelSettings` defaults (`enabled false`, `markupPercent 0`, `contractCurrency 'EUR'`, `minStars 0`, `excludedCodes []`); `saveHotelSettings(db,{markupPercent:'12.5',fxEurInr:'95',fxEurUsd:'1.1',minStars:'3',excludedCodes:'12, 40'})` returns ok and reloads as `12.5, 95, 1.1, 3, [12,40]`; negative markup, markup above 200, `minStars` 6 and non-numeric codes each return `{ok:false}`; `setHotelsEnabled(db,true)` fails with a message while `markupPercent` is 0, or `fxEurInr` is 0, or no `hotel_content` row exists, and succeeds once all three are set (insert one content row in the test).
- [ ] **Step 3:** Run (fails: module missing).
- [ ] **Step 4: Implement `src/lib/hotelData.ts`**

```ts
import type { D1Like } from './db';

export interface HotelSettings {
  enabled: boolean;
  markupPercent: number;
  fxEurInr: number;
  fxEurUsd: number;
  contractCurrency: string;
  destinationCode: string;
  minStars: number;
  excludedCodes: number[];
}
type Saved = { ok: true } | { ok: false; error: string };
const bad = (error: string): Saved => ({ ok: false, error });

async function allSettings(db: D1Like): Promise<Record<string, string>> {
  const { results } = await db.prepare(`SELECT key, value FROM hotel_settings`).bind().all<{ key: string; value: string }>();
  return Object.fromEntries(results.map((r) => [r.key, r.value]));
}

export async function loadHotelSettings(db: D1Like): Promise<HotelSettings> {
  const s = await allSettings(db);
  return {
    enabled: s.enabled === '1',
    markupPercent: Number(s.markup_percent) || 0,
    fxEurInr: Number(s.fx_eur_inr) || 0,
    fxEurUsd: Number(s.fx_eur_usd) || 0,
    contractCurrency: s.contract_currency || 'EUR',
    destinationCode: s.destination_code || 'AGR',
    minStars: Number(s.min_stars) || 0,
    excludedCodes: (s.excluded_codes || '').split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0),
  };
}

export async function isHotelsEnabled(db: D1Like): Promise<boolean> {
  return (await loadHotelSettings(db)).enabled;
}

async function put(db: D1Like, key: string, value: string) {
  await db.prepare(`INSERT INTO hotel_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(key, value).run();
}

export async function saveHotelSettings(db: D1Like, input: Record<string, unknown>): Promise<Saved> {
  const markup = Number(input.markupPercent);
  const inr = Number(input.fxEurInr);
  const usd = Number(input.fxEurUsd);
  const stars = Number(input.minStars);
  const codes = String(input.excludedCodes ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!Number.isFinite(markup) || markup < 0 || markup > 200) return bad('Markup must be between 0 and 200 percent.');
  if (!Number.isFinite(inr) || inr < 0 || !Number.isFinite(usd) || usd < 0) return bad('Exchange rates must be positive numbers.');
  if (!Number.isInteger(stars) || stars < 0 || stars > 5) return bad('Minimum stars must be 0 to 5.');
  if (codes.some((c) => !/^\d+$/.test(c))) return bad('Excluded hotel codes must be numbers separated by commas.');
  await put(db, 'markup_percent', String(markup));
  await put(db, 'fx_eur_inr', String(inr));
  await put(db, 'fx_eur_usd', String(usd));
  await put(db, 'min_stars', String(stars));
  await put(db, 'excluded_codes', codes.join(','));
  return { ok: true };
}

export async function setHotelsEnabled(db: D1Like, on: boolean): Promise<Saved> {
  if (on) {
    const s = await loadHotelSettings(db);
    if (s.markupPercent <= 0) return bad('Set a markup percent first.');
    if (s.fxEurInr <= 0) return bad('Set the EUR to INR exchange rate first.');
    const row = await db.prepare(`SELECT COUNT(*) AS n FROM hotel_content`).bind().first<{ n: number }>();
    if (!row?.n) return bad('Load the hotel content first (Refresh content).');
  }
  await put(db, 'enabled', on ? '1' : '0');
  return { ok: true };
}
```
- [ ] **Step 5:** Run tests → pass. `npx astro check` → 0 errors.
- [ ] **Step 6: Commit** `git add schema_hotels.sql src/lib/hotelData.ts && git commit -m "Hotels: schema and settings"`
- [ ] **Step 7: Production schema.** After the owner's yes, run `npx wrangler d1 execute iwisglobal-bookings --remote --file=schema_hotels.sql` (or the D1 MCP). Verify with `SELECT key FROM hotel_settings`.

---

### Task 4: Pricing and refund maths (pure)

**Files:**
- Create: `src/lib/hotelPricing.ts`
- Test: scratchpad `hotel-pricing-test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type GuestCurrency = 'INR' | 'USD';
  export interface PricingSettings { markupPercent: number; fxEurInr: number; fxEurUsd: number; contractCurrency: string }
  export function guestPrice(net: number, hbCurrency: string, target: GuestCurrency, s: PricingSettings): number | null
  export interface CancellationPolicy { amount: number; from: string }
  export function cancellationFeeNet(policies: CancellationPolicy[], at: Date): number
  export function guestRefund(sellTotal: number, netCost: number, policies: CancellationPolicy[], at: Date): number
  ```

- [ ] **Step 1: Failing test**

```ts
import { guestPrice, cancellationFeeNet, guestRefund } from '/Users/fasihuddinahmer/Projects/iwisglobal/src/lib/hotelPricing';
let failed = 0; const ok = (c: boolean, m: string) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) failed++; };
const s = { markupPercent: 10, fxEurInr: 90, fxEurUsd: 1.1, contractCurrency: 'EUR' };
ok(guestPrice(100, 'EUR', 'INR', s) === 9900, '100 EUR + 10% at 90 = 9900 INR');
ok(guestPrice(100, 'EUR', 'USD', s) === 121, '100 EUR + 10% at 1.1 = 121 USD');
ok(guestPrice(33.333, 'EUR', 'INR', s) === 3300, 'rounds up to a whole rupee (3299.967 -> 3300)');
ok(guestPrice(100, 'GBP', 'INR', s) === null, 'unknown currency cannot be converted');
ok(guestPrice(100, 'EUR', 'INR', { ...s, fxEurInr: 0 }) === null, 'missing rate cannot be converted');
const p = [{ amount: 50, from: '2026-12-01T23:59:00+05:30' }, { amount: 100, from: '2026-12-05T23:59:00+05:30' }];
ok(cancellationFeeNet(p, new Date('2026-11-30T00:00:00Z')) === 0, 'free before the first deadline');
ok(cancellationFeeNet(p, new Date('2026-12-02T00:00:00Z')) === 50, 'first fee after the first deadline');
ok(cancellationFeeNet(p, new Date('2026-12-10T00:00:00Z')) === 100, 'last fee after the last deadline');
ok(cancellationFeeNet([], new Date()) === 0, 'no policy means no fee');
ok(guestRefund(9900, 100, p, new Date('2026-11-30T00:00:00Z')) === 9900, 'full refund when free');
ok(guestRefund(9900, 100, p, new Date('2026-12-02T00:00:00Z')) === 4950, 'half refunded at a 50% fee');
ok(guestRefund(9900, 100, p, new Date('2026-12-10T00:00:00Z')) === 0, 'nothing refunded at a 100% fee');
ok(guestRefund(9900, 100, [{ amount: 400, from: '2026-01-01T00:00:00Z' }], new Date('2026-12-10T00:00:00Z')) === 0, 'never negative when the fee exceeds the price');
ok(guestRefund(9900, 0, p, new Date('2026-12-10T00:00:00Z')) === 0, 'zero net cost is treated as no refund, not a crash');
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2:** Run (fails: module missing).
- [ ] **Step 3: Implement**

```ts
// Hotel prices: what the guest pays, and what comes back on a cancellation.
// Pure, so the server and the tests share one set of rules.

export type GuestCurrency = 'INR' | 'USD';

export interface PricingSettings {
  markupPercent: number;
  fxEurInr: number;
  fxEurUsd: number;
  contractCurrency: string;
}

// Net + markup, converted, rounded up to a whole unit. Null when Hotelbeds
// quotes in a currency we have no rate for.
export function guestPrice(net: number, hbCurrency: string, target: GuestCurrency, s: PricingSettings): number | null {
  if (hbCurrency !== 'EUR' || s.contractCurrency !== 'EUR') return null;
  const rate = target === 'INR' ? s.fxEurInr : s.fxEurUsd;
  if (!(rate > 0) || !(net >= 0)) return null;
  const value = net * (1 + s.markupPercent / 100) * rate;
  return Math.ceil(Math.round(value * 1000) / 1000);
}

// Hotelbeds cancellation policy: from this moment on, cancelling costs `amount`
// (net currency). Later entries replace earlier ones.
export interface CancellationPolicy {
  amount: number;
  from: string;
}

export function cancellationFeeNet(policies: CancellationPolicy[], at: Date): number {
  let fee = 0;
  const sorted = [...policies].sort((a, b) => Date.parse(a.from) - Date.parse(b.from));
  for (const p of sorted) if (Date.parse(p.from) <= at.getTime()) fee = Math.max(fee, p.amount);
  return fee;
}

// The guest bears the fee in proportion to the price they paid, so the markup
// is refunded in step with the hotel's share.
export function guestRefund(sellTotal: number, netCost: number, policies: CancellationPolicy[], at: Date): number {
  if (!(netCost > 0)) return 0;
  const ratio = Math.min(1, cancellationFeeNet(policies, at) / netCost);
  return Math.max(0, sellTotal - Math.ceil(sellTotal * ratio));
}
```
- [ ] **Step 4:** Run tests → all ok.
- [ ] **Step 5: Commit** `git add src/lib/hotelPricing.ts && git commit -m "Hotels: guest price and cancellation refund rules"`

---

### Task 5: Search validation, request building and response parsing (pure)

**Files:**
- Create: `src/lib/hotelSearch.ts`
- Test: scratchpad `hotel-search-test.ts` (uses `hb-avail.json` from Task 2 for the parser)

**Interfaces:**
- Produces:
  ```ts
  export interface SearchRoom { adults: number; childAges: number[] }
  export interface SearchInput { checkIn: string; checkOut: string; rooms: SearchRoom[] }
  export type SearchErrorCode = 'bad_dates' | 'too_soon' | 'too_long' | 'bad_rooms' | 'bad_adults' | 'bad_children' | 'bad_age'
  export interface SearchError { code: SearchErrorCode; params?: Record<string, string | number> }
  export const MAX_ROOMS: 4, MAX_NIGHTS: 14, MAX_ADULTS_PER_ROOM: 4, MAX_CHILDREN_PER_ROOM: 3, MIN_LEAD_DAYS: 1
  export function parseSearchInput(raw: unknown): SearchInput | null
  export function validateSearch(input: SearchInput, today: string): SearchError[]
  export function buildAvailabilityBody(input: SearchInput, hotelCodes: number[]): object
  export interface RateOption { rateKey: string; rateType: 'BOOKABLE' | 'RECHECK'; net: number; boardCode: string; boardName: string; roomCode: string; roomName: string; rooms: number; adults: number; children: number; allotment: number; cancellation: CancellationPolicy[]; rateCommentsId: string | null; promotions: string[] }
  export interface HotelResult { code: number; name: string; categoryCode: string; categoryName: string; currency: string; rates: RateOption[] }
  export function parseAvailability(json: any): HotelResult[]
  ```

- [ ] **Step 1: Failing test**

```ts
import { readFileSync } from 'node:fs';
import { parseSearchInput, validateSearch, buildAvailabilityBody, parseAvailability } from '/Users/fasihuddinahmer/Projects/iwisglobal/src/lib/hotelSearch';
let failed = 0; const ok = (c: boolean, m: string) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) failed++; };
const base = { checkIn: '2026-12-10', checkOut: '2026-12-12', rooms: [{ adults: 2, childAges: [] }] };
const today = '2026-12-01';
const codes = (i: any) => validateSearch(i, today).map((e) => e.code);
ok(codes(base).length === 0, 'a normal search is valid');
ok(codes({ ...base, checkOut: '2026-12-10' }).includes('bad_dates'), 'zero nights rejected');
ok(codes({ ...base, checkIn: '2026-12-01', checkOut: '2026-12-02' }).includes('too_soon'), 'same-day check-in rejected');
ok(codes({ ...base, checkOut: '2027-01-10' }).includes('too_long'), 'over 14 nights rejected');
ok(codes({ ...base, rooms: [] }).includes('bad_rooms'), 'no rooms rejected');
ok(codes({ ...base, rooms: [{ adults: 0, childAges: [] }] }).includes('bad_adults'), 'zero adults rejected');
ok(codes({ ...base, rooms: [{ adults: 2, childAges: [18] }] }).includes('bad_age'), 'age 18 rejected');
ok(codes({ ...base, rooms: [{ adults: 2, childAges: [-1] }] }).includes('bad_age'), 'negative age rejected');
ok(parseSearchInput({ ...base, rooms: [{ adults: 2, childAges: [3, null] }] }) === null, 'a child without an age is not a valid input');
ok(parseSearchInput({ ...base, rooms: [{ adults: '2', childAges: ['4'] }] })?.rooms[0].childAges[0] === 4, 'numeric strings are cleaned');
const body: any = buildAvailabilityBody({ ...base, rooms: [{ adults: 2, childAges: [] }, { adults: 2, childAges: [] }, { adults: 3, childAges: [5] }] }, [1, 2]);
ok(body.stay.checkIn === '2026-12-10' && body.hotels.hotel.length === 2, 'stay and hotels set');
ok(body.occupancies.length === 2, 'identical rooms are grouped, different ones kept apart');
ok(body.occupancies[0].rooms === 2 && body.occupancies[0].adults === 2 && body.occupancies[0].children === 0, 'two identical rooms in one occupancy');
ok(body.occupancies[1].paxes[0].type === 'CH' && body.occupancies[1].paxes[0].age === 5, 'child age sent as a CH pax');
const fixture = JSON.parse(readFileSync(process.env.HB_AVAIL!, 'utf8'));
const parsed = parseAvailability(fixture);
ok(parsed.length > 0 && parsed[0].rates.length > 0, 'fixture parses into hotels with rates');
ok(parsed.every((h) => h.rates.every((r) => r.rateKey && (r.rateType === 'BOOKABLE' || r.rateType === 'RECHECK') && r.net > 0)), 'every rate has a key, a type and a net price');
ok(parseAvailability(null).length === 0 && parseAvailability({ hotels: {} }).length === 0, 'empty responses give no hotels');
process.exit(failed ? 1 : 0);
```
Run with `HB_AVAIL=$S/hb-avail.json node …`.

- [ ] **Step 2:** Run (fails: module missing).
- [ ] **Step 3: Implement**

```ts
// Hotel search: what a guest may ask for, the request sent to Hotelbeds, and
// the answer reduced to what the pages show. Pure (no network, no database).

import type { CancellationPolicy } from './hotelPricing';
import { addDays } from './customTrip';

export interface SearchRoom { adults: number; childAges: number[] }
export interface SearchInput { checkIn: string; checkOut: string; rooms: SearchRoom[] }
export type SearchErrorCode = 'bad_dates' | 'too_soon' | 'too_long' | 'bad_rooms' | 'bad_adults' | 'bad_children' | 'bad_age';
export interface SearchError { code: SearchErrorCode; params?: Record<string, string | number> }

export const MAX_ROOMS = 4;
export const MAX_NIGHTS = 14;
export const MAX_ADULTS_PER_ROOM = 4;
export const MAX_CHILDREN_PER_ROOM = 3;
export const MIN_LEAD_DAYS = 1;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const nights = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

// Cleans a posted search; null when it is not shaped like one (including a
// child with no usable age: ages are mandatory).
export function parseSearchInput(raw: unknown): SearchInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.checkIn !== 'string' || typeof r.checkOut !== 'string' || !Array.isArray(r.rooms)) return null;
  const rooms: SearchRoom[] = [];
  for (const item of r.rooms.slice(0, 20)) {
    if (!item || typeof item !== 'object') return null;
    const room = item as Record<string, unknown>;
    const adults = Number(room.adults);
    const ages = Array.isArray(room.childAges) ? room.childAges : [];
    const childAges = ages.map((a) => (a === null || a === '' || a === undefined ? NaN : Number(a)));
    if (!Number.isInteger(adults) || childAges.some((a) => !Number.isInteger(a))) return null;
    rooms.push({ adults, childAges });
  }
  return { checkIn: r.checkIn, checkOut: r.checkOut, rooms };
}

export function validateSearch(input: SearchInput, today: string): SearchError[] {
  const errors: SearchError[] = [];
  if (!DATE.test(input.checkIn) || !DATE.test(input.checkOut) || nights(input.checkIn, input.checkOut) < 1) {
    errors.push({ code: 'bad_dates' });
  } else {
    if (input.checkIn < addDays(today, MIN_LEAD_DAYS)) errors.push({ code: 'too_soon' });
    if (nights(input.checkIn, input.checkOut) > MAX_NIGHTS) errors.push({ code: 'too_long', params: { max: MAX_NIGHTS } });
  }
  if (input.rooms.length < 1 || input.rooms.length > MAX_ROOMS) errors.push({ code: 'bad_rooms', params: { max: MAX_ROOMS } });
  for (const room of input.rooms) {
    if (room.adults < 1 || room.adults > MAX_ADULTS_PER_ROOM) errors.push({ code: 'bad_adults', params: { max: MAX_ADULTS_PER_ROOM } });
    if (room.childAges.length > MAX_CHILDREN_PER_ROOM) errors.push({ code: 'bad_children', params: { max: MAX_CHILDREN_PER_ROOM } });
    if (room.childAges.some((a) => a < 0 || a > 17)) errors.push({ code: 'bad_age' });
  }
  return errors;
}

// One request for the whole party. Rooms with the same occupants (and the same
// children's ages) share an occupancy node with a room count; any difference
// gets its own node, as Hotelbeds asks.
export function buildAvailabilityBody(input: SearchInput, hotelCodes: number[]): object {
  const groups = new Map<string, { rooms: number; adults: number; childAges: number[] }>();
  for (const room of input.rooms) {
    const ages = [...room.childAges].sort((a, b) => a - b);
    const key = `${room.adults}|${ages.join(',')}`;
    const g = groups.get(key);
    if (g) g.rooms += 1;
    else groups.set(key, { rooms: 1, adults: room.adults, childAges: ages });
  }
  return {
    stay: { checkIn: input.checkIn, checkOut: input.checkOut },
    occupancies: [...groups.values()].map((g) => ({
      rooms: g.rooms,
      adults: g.adults,
      children: g.childAges.length,
      ...(g.childAges.length ? { paxes: g.childAges.map((age) => ({ type: 'CH', age })) } : {}),
    })),
    hotels: { hotel: hotelCodes.slice(0, 2000) },
  };
}

export interface RateOption {
  rateKey: string;
  rateType: 'BOOKABLE' | 'RECHECK';
  net: number;
  boardCode: string;
  boardName: string;
  roomCode: string;
  roomName: string;
  rooms: number;
  adults: number;
  children: number;
  allotment: number;
  cancellation: CancellationPolicy[];
  rateCommentsId: string | null;
  promotions: string[];
}

export interface HotelResult {
  code: number;
  name: string;
  categoryCode: string;
  categoryName: string;
  currency: string;
  rates: RateOption[];
}

export function parseAvailability(json: any): HotelResult[] {
  const hotels = json?.hotels?.hotels;
  if (!Array.isArray(hotels)) return [];
  const out: HotelResult[] = [];
  for (const h of hotels) {
    const rates: RateOption[] = [];
    for (const room of h.rooms ?? []) {
      for (const rate of room.rates ?? []) {
        const net = Number(rate.net);
        if (!rate.rateKey || !(net > 0) || rate.packaging === true) continue; // opaque/packaged rates are never shown
        if (rate.rateType !== 'BOOKABLE' && rate.rateType !== 'RECHECK') continue;
        rates.push({
          rateKey: String(rate.rateKey),
          rateType: rate.rateType,
          net,
          boardCode: String(rate.boardCode ?? ''),
          boardName: String(rate.boardName ?? ''),
          roomCode: String(room.code ?? ''),
          roomName: String(room.name ?? ''),
          rooms: Number(rate.rooms ?? 1),
          adults: Number(rate.adults ?? 0),
          children: Number(rate.children ?? 0),
          allotment: Number(rate.allotment ?? 0),
          cancellation: (rate.cancellationPolicies ?? []).map((c: any) => ({ amount: Number(c.amount), from: String(c.from) })),
          rateCommentsId: rate.rateCommentsId ? String(rate.rateCommentsId) : null,
          promotions: (rate.promotions ?? []).map((p: any) => String(p.name ?? p.code ?? '')).filter(Boolean),
        });
      }
    }
    if (rates.length) {
      out.push({
        code: Number(h.code),
        name: String(h.name ?? ''),
        categoryCode: String(h.categoryCode ?? ''),
        categoryName: String(h.categoryName ?? ''),
        currency: String(h.currency ?? ''),
        rates,
      });
    }
  }
  return out;
}
```
If the Task 2 fixture shows different field names, fix the parser here to match before Step 4.
- [ ] **Step 4:** Run tests → all ok.
- [ ] **Step 5: Commit** `git add src/lib/hotelSearch.ts && git commit -m "Hotels: search rules, request building and response parsing"`

---

### Task 6: Content sync (Hotelbeds → D1)

**Files:**
- Create: `src/lib/hotelContent.ts`, `src/pages/api/hotels/sync.ts`, `.github/workflows/hotel-content-sync.yml`
- Test: scratchpad `hotel-content-test.ts`

**Interfaces:**
- Consumes: `hbConfig`, `hbRequest`, `loadHotelSettings`.
- Produces:
  ```ts
  export interface HotelContent { code: number; name: string; categoryCode: string; categoryName: string; stars: number; address: string; postalCode: string; city: string; phone: string; lat: number | null; lon: number | null; description: string; images: { path: string; type: string }[]; facilities: { code: number; group: number; name: string; paid: boolean; yesOrNo?: boolean }[] }
  export function parseContentHotel(h: any): HotelContent | null
  export async function syncHotelContent(env: Record<string, any>, db: D1Like): Promise<{ ok: true; count: number } | { ok: false; error: string }>
  export async function listHotelCodes(db: D1Like): Promise<number[]>
  export async function getHotelContent(db: D1Like, codes: number[]): Promise<Map<number, HotelContent>>
  export const imageUrl: (path: string) => string   // https://photos.hotelbeds.com/giata/bigger/<path>
  ```

- [ ] **Step 1: Failing test:** stub `fetch` to return two pages of content (`{from:1,to:2,total:3,hotels:[...]}` then `{from:3,to:3,total:3,hotels:[...]}`); assert `syncHotelContent` fetches both pages, stores 3 rows, records `hotel_sync.last_count = 3`; a hotel without `code` or `name.content` is skipped; a repeated sync updates rather than duplicates; `listHotelCodes` drops codes in `excluded_codes` and hotels below `min_stars`; a fetch failure on page 2 returns `{ok:false}`, leaves page 1 rows untouched and writes `last_error`; with no keys configured it returns `{ok:false,error:'Hotelbeds keys are not configured.'}`. Parse this sample:

```ts
const sample = { code: 42, name: { content: 'Hotel One' }, categoryCode: '4EST', category: { description: { content: '4 STARS' } },
  address: { content: 'Fatehabad Rd' }, postalCode: '282001', city: { content: 'AGRA' }, phones: [{ phoneNumber: '+91 562 1', phoneType: 'PHONEBOOKING' }],
  coordinates: { latitude: 27.1, longitude: 78.0 }, description: { content: 'Nice.' },
  images: [{ path: '00/000042/a.jpg', imageTypeCode: 'GEN' }], facilities: [{ facilityCode: 10, facilityGroupCode: 70, indFee: true, indYesOrNo: true, description: { content: 'Pool' } }] };
```
and expect `stars 4` (digit parsed from `categoryCode`), `phone '+91 562 1'`, `facilities[0].paid === true`.

- [ ] **Step 2:** Run (fails).
- [ ] **Step 3: Implement `parseContentHotel` and `syncHotelContent`.** Page size 100: loop `GET /hotel-content-api/1.0/hotels?destinationCode=<code>&fields=all&language=ENG&from=<n>&to=<n+99>` until `to >= total`; each page upserts every field with `INSERT … ON CONFLICT(code) DO UPDATE`; after the loop write `hotel_sync (last_run, last_count, last_error='')`; on any non-200 write `last_error` and return `{ok:false}` without deleting rows. Stars: `Number((categoryCode.match(/^(\d)/) ?? [])[1] ?? 0)`.
- [ ] **Step 4: Protected endpoint** `src/pages/api/hotels/sync.ts`:

```ts
import type { APIRoute } from 'astro';
import { resolveEnv } from '../../../lib/env';
import { syncHotelContent } from '../../../lib/hotelContent';

export const prerender = false;

// Weekly refresh, called by .github/workflows/hotel-content-sync.yml with the
// shared secret in the Authorization header. Hotelbeds requires content to be
// refreshed at least weekly.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = resolveEnv(locals);
  const sent = request.headers.get('authorization') ?? '';
  if (!env.HOTEL_SYNC_SECRET || sent !== `Bearer ${env.HOTEL_SYNC_SECRET}` || !env.DB) {
    return new Response('Not found', { status: 404 });
  }
  const result = await syncHotelContent(env, env.DB);
  return new Response(JSON.stringify(result), { status: result.ok ? 200 : 502, headers: { 'Content-Type': 'application/json' } });
};
```
- [ ] **Step 5: Workflow** `.github/workflows/hotel-content-sync.yml`: `on: schedule: - cron: '0 3 * * 1'` and `workflow_dispatch`; one step `curl -fsS -X POST -H "Authorization: Bearer ${{ secrets.HOTEL_SYNC_SECRET }}" https://www.iwisglobal.com/api/hotels/sync`. The owner adds the `HOTEL_SYNC_SECRET` GitHub secret and the same value in Cloudflare.
- [ ] **Step 6:** Run tests → pass; `npx astro check` → 0 errors.
- [ ] **Step 7: Commit** `git add src/lib/hotelContent.ts src/pages/api/hotels/sync.ts .github/workflows/hotel-content-sync.yml && git commit -m "Hotels: weekly content sync into D1"`

---

### Task 7: Search service, endpoint, `/hotels` page and results island

**Files:**
- Create: `src/lib/hotelSearchService.ts`, `src/pages/api/hotels/search.ts`, `src/pages/hotels/index.astro`, `src/components/HotelSearch.tsx`
- Modify: `src/i18n/en.ts` (and `es/fr/de` English placeholders; translated in Task 16)
- Test: scratchpad `hotel-service-test.ts`

**Interfaces:**
- Consumes: `parseSearchInput`, `validateSearch`, `buildAvailabilityBody`, `parseAvailability`, `guestPrice`, `listHotelCodes`, `getHotelContent`, `hbRequest`, `loadHotelSettings`.
- Produces:
  ```ts
  export interface ShownRate { rateKey: string; rateType: 'BOOKABLE' | 'RECHECK'; roomName: string; boardName: string; price: number; currency: GuestCurrency; freeCancellationUntil: string | null; promotions: string[]; rooms: number }
  export interface ShownHotel { code: number; name: string; stars: number; categoryName: string; address: string; image: string | null; facilities: string[]; from: number; rates: ShownRate[] }
  export async function searchHotels(env: Record<string, any>, db: D1Like, raw: unknown, currency: GuestCurrency, today: string): Promise<{ status: number; body: Record<string, unknown> }>
  ```
  Success body `{ hotels: ShownHotel[], searchId: string }`; errors `403 not_available`, `400 bad_request`, `400 invalid_search {errors}`, `503 unavailable` (no hotels loaded), `502 unavailable`.

- [ ] **Step 1: Failing test** with stubbed `fetch` returning the Task 2 fixture and an in-memory DB with content rows for the fixture's codes: enabled + markup/fx set → success with hotels sorted by `from` ascending and `price` equal to `guestPrice(net,…)` for the cheapest rate; disabled → `403`; invalid search (child without age) → `400 bad_request`; an excluded code is not requested (check the stubbed request body's `hotels.hotel`); `fetch` called exactly once (workflow rule); Hotelbeds 500 → `502`; hotels whose content row is missing are skipped; a hotel quoted in a currency we cannot convert is skipped; one `hotel_rate_cache` row per shown rate, expiring in 30 minutes, holding `hotelCode, hotelName, roomName, boardName, net, currency, cancellation, rateType, search`; `net` never appears in the response body.
- [ ] **Step 2:** Run (fails).
- [ ] **Step 3: Implement `searchHotels`:** parse → validate (`today` injected) → `isHotelsEnabled` → codes from `listHotelCodes` (empty → `503`) → one `hbRequest(cfg,'/hotel-api/1.0/hotels',{body})` → `parseAvailability` → join with content → price with `guestPrice` → write rate cache rows (`INSERT OR REPLACE`; delete expired rows first) → `freeCancellationUntil` = earliest policy `from` (null when no policy, or when the first fee applies already) → sort by `from`. `searchId` is `crypto.randomUUID()`.
- [ ] **Step 4: Endpoint** `src/pages/api/hotels/search.ts`: JSON POST wrapper identical in shape to `src/pages/api/custom-trip/order.ts` (read body, call `searchHotels(env, env.DB, body, resolveCurrency(url.searchParams, cookies.get('currency')?.value), todayIst())`, return JSON). `resolveCurrency` is from `src/lib/currency.ts`, `todayIst` from `src/lib/availability.ts`.
- [ ] **Step 5: Page and island.** `/hotels` mirrors `customize-your-tour.astro`: `prerender = false`; `live = enabled`; non-admin and not live → `new Response('Not found',{status:404})`; admin preview banner; `noindex={!live}`; passes `t = dict.hotels`, `currency`, `intlLocale(locale)`, `locale` to `HotelSearch` (`client:load`). `HotelSearch.tsx` state: `checkIn`, `checkOut`, `rooms: {adults:number; childAges:(number|'')[]}[]` (start with one room, 2 adults), results, loading, error. Behaviour: native date inputs with `min` from `getAvailability().minBookableDate`; per-room adults select 1–4; "Add child" adds a mandatory age select 0–17 (an unset age blocks submit with `t.errors.bad_age` and focuses the select); posts to `/api/hotels/search`; maps `invalid_search` errors through `t.errors[code]`; renders cards with first image, stars, name, category, address, "from" price, up to 5 facilities, and a rate list (room, board, price, free-cancellation date or non-refundable, promotions). "Select" wiring is added in Task 12. Use the Tailwind classes of `TourCustomizer.tsx` (`fieldClass`, `primaryButton`, 44px targets, `focus-visible` rings).
- [ ] **Step 6: Dictionary.** Add `hotels` to `en.ts`: `meta{title,description}`, `heading`, `intro`, `previewBanner`, `labels{checkIn,checkOut,rooms,room,adults,children,childAge,addChild,addRoom,removeRoom,search,searching}`, `results{none,from,perNight,total,freeCancel,nonRefundable,select,facilities,promotion}`, `errors{unavailable,bad_dates,too_soon,too_long,bad_rooms,bad_adults,bad_children,bad_age}`. `es/fr/de` get the English text for now so `astro check` stays green.
- [ ] **Step 7:** Run tests; `npx astro check` → 0 errors; `npm run build` passes.
- [ ] **Step 8: Browser check** with the harness style used for the tour builder (esbuild bundle of `HotelSearch.tsx`, stubbed `fetch` returning one `ShownHotel`) at 400px and 1280px: add a child, confirm an unset age blocks submit, results render, keyboard focus order is sane.
- [ ] **Step 9: Commit** `git add src/lib/hotelSearchService.ts src/pages/api/hotels/search.ts src/pages/hotels/index.astro src/components/HotelSearch.tsx src/i18n && git commit -m "Hotels: search endpoint and /hotels page (hidden until switched on)"`

---

### Task 8: Admin settings and content refresh

**Files:**
- Create: `src/pages/admin/hotels/index.astro`
- Modify: `src/layouts/AdminLayout.astro` (nav link beside `Custom trips`, same `aria-current` pattern at the `isCustomTrips` lines)

**Interfaces:** Consumes `loadHotelSettings`, `saveHotelSettings`, `setHotelsEnabled`, `syncHotelContent`. Produces the page at `/admin/hotels`.

- [ ] **Step 1:** Build the page by following `src/pages/admin/custom-trips/index.astro`: same auth redirect (`isAdminAuthenticated`), POST actions `save`, `switch_on`, `switch_off`, `refresh`, flash message through the query string. Editable: markup percent, EUR→INR, EUR→USD, minimum stars, excluded hotel codes (comma-separated). Read-only: destination code, contract currency, hotel count (`SELECT COUNT(*) FROM hotel_content`), last sync time, count and error from `hotel_sync`. "Refresh content" runs `syncHotelContent(env, db)` and reports the count or error. Switch buttons use `setHotelsEnabled` and show its error text.
- [ ] **Step 2:** Add the nav link `Hotels` → `/admin/hotels`.
- [ ] **Step 3:** `npx astro check` → 0 errors; `npm run build` passes.
- [ ] **Step 4: Commit** `git add src/pages/admin/hotels src/layouts/AdminLayout.astro && git commit -m "Hotels: admin settings and content refresh"`
- [ ] **Step 5 (owner, production):** push after the owner's yes; the owner adds the Hotelbeds secrets in Cloudflare; in `/admin/hotels` press Refresh content, set markup and rates, switch on, and search a real date on `/hotels`. Milestone 1 is accepted when results appear with images and prices.

---

## Milestone 2 — Rate check, details, payment, booking

### Task 9: CheckRate and the stored quote

**Files:**
- Create: `src/lib/hotelQuote.ts`, `src/pages/api/hotels/rate.ts`
- Test: scratchpad `hotel-quote-test.ts`

**Interfaces:**
- Consumes: `hbRequest`, `guestPrice`, `loadHotelSettings`, rate cache rows written by Task 7.
- Produces:
  ```ts
  export interface Quote { bookingId: string; hotelCode: number; hotelName: string; roomName: string; boardName: string; checkIn: string; checkOut: string; price: number; currency: GuestCurrency; cancellation: CancellationPolicy[]; rateComments: string[]; changed: boolean; rooms: number }
  export async function rateHotel(env: Record<string, any>, db: D1Like, raw: unknown, currency: GuestCurrency, now?: Date): Promise<{ status: number; body: Record<string, unknown> }>
  ```
  Request body `{ rateKey: string, shownPrice: number, trip?: string }`. `shownPrice` only sets `changed`; it never affects the price. Response `{ quote }`; errors `403 not_available`, `400 bad_request`, `409 sold_out`, `502 unavailable`.

- [ ] **Step 1: Failing test** (stubbed `fetch`): (a) a `BOOKABLE` rate makes **no** HTTP call, creates a `quoted` row, response price equals the server price; (b) a `RECHECK` rate makes exactly one `POST /hotel-api/1.0/checkrates` with body `{rooms:[{rateKey}]}`, the stored `net_cost` is the CheckRate net, `changed === true` when the new price differs from `shownPrice`; (c) CheckRate error or empty hotel → `409 sold_out`, no row; (d) rate comments from CheckRate (`rate.rateComments` text) appear in `rateComments`; (e) a tampered `shownPrice` (1) does not change the stored `sell_total`; (f) `rateKey` empty or longer than 600 characters → `400`; (g) an unknown or expired cache row → `409 sold_out`; (h) `selected_json` holds `rateKey`, `cancellation`, `boardName`, `roomName`; (i) a `trip` value that is not an existing custom trip id is ignored (stored as empty), an existing one is stored in `custom_trip_id`.
- [ ] **Step 2:** Run (fails).
- [ ] **Step 3: Implement.** Load the cache row by `rateKey` (missing/expired → `409 sold_out`). If `rateType === 'RECHECK'` call CheckRate and replace net, cancellation policy and comments with the response (`hotel.rooms[0].rates[0].net`, `.cancellationPolicies`, `.rateComments`). Price with `guestPrice`. Insert `hotel_bookings` (`id = 'hb_' + crypto.randomUUID()`, `status 'quoted'`, `search_json`, `selected_json`, `net_cost`, `sell_total`, `currency`, `hotel_code`, `custom_trip_id`). Return the quote.
- [ ] **Step 4:** Endpoint wrapper `src/pages/api/hotels/rate.ts` (same shape as Task 7's).
- [ ] **Step 5:** Run tests (including Task 7's) → pass; `npx astro check` → 0 errors.
- [ ] **Step 6: Commit** `git add src/lib/hotelQuote.ts src/pages/api/hotels/rate.ts && git commit -m "Hotels: CheckRate and server-stored quotes"`

---

### Task 10: Guest details and the Razorpay order

**Files:**
- Create: `src/lib/hotelPayment.ts` (part 1), `src/pages/api/hotels/order.ts`
- Modify: `src/lib/payments/razorpay.ts` (add `createHotelOrder`, `refundPaymentAmount`)
- Test: scratchpad `hotel-pay-test.ts` (extended in Tasks 11 and 14)

**Interfaces:**
- Produces:
  ```ts
  export interface GuestRoom { names: { first: string; last: string; age?: number; type: 'AD' | 'CH' }[] }
  export interface HotelContact { holderFirst: string; holderLast: string; email: string; phone: string }
  export function validateHotelGuests(search: SearchInput, rooms: unknown, contact: unknown): { ok: true; rooms: GuestRoom[]; contact: HotelContact } | { ok: false; fields: string[] }
  export async function handleHotelOrder(env: Record<string, any>, db: D1Like | undefined, raw: unknown): Promise<{ status: number; body: Record<string, unknown> }>
  // razorpay.ts
  export async function createHotelOrder(env: Record<string, unknown>, input: { amountMinor: number; currency: 'INR' | 'USD'; bookingId: string; receipt: string }): Promise<OrderResult>
  export async function refundPaymentAmount(env: Record<string, unknown>, paymentId: string, amountMinor: number): Promise<void>
  ```
  `/api/hotels/order` body `{ bookingId, rooms: [{ names: [{first,last,age?}] }], contact: {holderFirst,holderLast,email,phone}, locale }`; response `{ bookingId, orderId, amount, currency, publicKey }`; errors `403`, `400 bad_request`, `400 bad_details {fields}`, `404 not_found`, `409 not_quoted`, `502 gateway`.

- [ ] **Step 1: Failing test:** `validateHotelGuests` requires a first and last name for every adult and child in every room (counts must equal the search), children carry the search's age (a posted age that differs is overwritten), holder email and phone follow `validateContact` in `customTrip.ts`, names 1–60 characters with no digits; `handleHotelOrder`: a `quoted` booking → the Razorpay `fetch` stub receives `amount = sell_total * 100` and `notes.kind = 'hotel'`, the row stores `order_id`, holder, guests; a booking not in `quoted` → `409`; unknown id → `404`; Razorpay stub failing → `502` and the row stays `quoted` with no `order_id`; a quote older than 30 minutes → `409 not_quoted`.
- [ ] **Step 2:** Run (fails).
- [ ] **Step 3: Implement.** `createHotelOrder`: copy `createCustomTripOrder` with `notes: { kind: 'hotel', hotelBookingId: input.bookingId }`. `refundPaymentAmount`: copy `razorpayProvider.refundPayment` with `body: JSON.stringify({ amount: amountMinor })` and the same error mapping. `handleHotelOrder`: load the row (status `quoted`, `created_at` within 30 minutes), validate guests against `JSON.parse(search_json)`, create the order, then `UPDATE hotel_bookings SET order_id=?, holder_name=?, email=?, phone=?, guests_json=?, locale=?, updated_at=? WHERE id=? AND status='quoted'`.
- [ ] **Step 4:** Endpoint wrapper `src/pages/api/hotels/order.ts`.
- [ ] **Step 5:** Run tests → pass; `npx astro check` → 0 errors.
- [ ] **Step 6: Commit** `git add src/lib/hotelPayment.ts src/lib/payments/razorpay.ts src/pages/api/hotels/order.ts && git commit -m "Hotels: guest details and Razorpay order"`

---

### Task 11: Verify, book, reconcile, refund on failure (the money path)

**Files:**
- Modify: `src/lib/hotelPayment.ts` (part 2), `src/lib/hotelbeds.ts`, `src/lib/email.ts`, `src/pages/api/webhooks/razorpay.ts`
- Create: `src/pages/api/hotels/verify.ts`
- Test: `hotel-pay-test.ts` (extend)

**Interfaces:**
- Produces:
  ```ts
  // hotelbeds.ts
  export async function bookHotel(cfg: HbConfig, req: { clientReference: string; holder: { name: string; surname: string }; rooms: { rateKey: string; paxes: { roomId: number; type: 'AD' | 'CH'; name: string; surname: string; age?: number }[] }[]; remark?: string }): Promise<{ status: number; json: any }>   // POST /hotel-api/1.0/bookings, timeoutMs 70000
  export async function getHotelBooking(cfg: HbConfig, reference: string): Promise<{ status: number; json: any }>   // GET /hotel-api/1.0/bookings/{reference}
  export async function listHotelBookingsByReference(cfg: HbConfig, clientReference: string, from: string, to: string): Promise<{ status: number; json: any }>   // GET /hotel-api/1.0/bookings?start=..&end=..&clientReference=..
  export async function cancelHotelBooking(cfg: HbConfig, reference: string): Promise<{ status: number; json: any }>   // DELETE /hotel-api/1.0/bookings/{reference}?cancellationFlag=CANCELLATION
  // email.ts
  export async function sendHotelAlertEmail(env: Record<string, any>, subject: string, body: string): Promise<void>
  // hotelPayment.ts
  export type HotelFinalizeOutcome = 'booked' | 'duplicate' | 'unknown' | 'mismatch' | 'failed_refunded' | 'failed_refund_error'
  export async function finalizeHotelBooking(env: Record<string, any>, db: D1Like, paid: { bookingId: string; orderId: string; paymentId: string; amountMinor: number; currency: string }): Promise<HotelFinalizeOutcome>
  export async function handleHotelVerify(env: Record<string, any>, db: D1Like | undefined, raw: unknown): Promise<{ status: number; body: Record<string, unknown> }>
  ```
  Verify body: Razorpay `{razorpay_order_id, razorpay_payment_id, razorpay_signature}`. Success `{ success: true, bookingId }`; failed-and-refunded `409 { error: 'not_booked_refunded', bookingId }`.

- [ ] **Step 1: Failing tests** (stubbed Razorpay, Hotelbeds and Resend `fetch`, distinguished by URL):
  1. Happy path: `quoted` → `finalizeHotelBooking` → `booked`; `hb_reference` from `booking.reference`; `supplier_json` holds `booking.invoiceCompany` name, registration number and code; exactly one `POST …/bookings`; guest and admin emails attempted (Resend stub counts 2, using the Task 13 stub until then).
  2. Mismatch (amount, currency or order id differs) → `mismatch`, no Hotelbeds call, status unchanged.
  3. Duplicate: finalize twice, and verify + webhook simultaneously (`Promise.all`) → exactly one Hotelbeds booking and one pair of emails; the loser returns `duplicate`.
  4. Hotelbeds HTTP 500 → reconcile lookup finds nothing → full refund through `refundPaymentAmount(sell_total*100)`, status `failed`, outcome `failed_refunded`.
  5. Hotelbeds call throws (timeout) but the reconcile lookup **finds** the booking → status `booked` with that reference, no refund.
  6. Refund itself fails → status returns to `paid`, outcome `failed_refund_error`, an alert email goes to the owner.
  7. A booking left `paid` with no `hb_reference` and `updated_at` older than 90 s is completed or refunded when the webhook arrives again.
  8. Verify with a wrong signature → `400`; with a non-hotel order → `400`.
- [ ] **Step 2:** Run (fails).
- [ ] **Step 3: Implement.**
  - `finalizeHotelBooking`: load row; check `order_id`, `currency` and `sell_total * 100 === amountMinor` else `'mismatch'`; atomic claim `UPDATE hotel_bookings SET status='paid', payment_id=?, updated_at=? WHERE id=? AND status='quoted'` (0 changes → if the row is `paid` with no `hb_reference` and `updated_at` older than 90 s, re-claim it for retry; otherwise `'duplicate'`); build the booking request from `guests_json` (holder = contact; `roomId` is the 1-based room index; adults then children per room; `clientReference = row.id`); call `bookHotel` in `try/catch`; success (`status 200` and `json.booking.reference`) → write `hb_reference`, `supplier_json = { name: invoiceCompany.company, vat: invoiceCompany.registrationNumber, code: invoiceCompany.code }`, status `booked`, send voucher emails, return `'booked'`; any other outcome → reconcile with `listHotelBookingsByReference` over `created_at-1 day … +1 day`; found → treat as success; not found → refund and mark `failed`.
  - Refund: claim `UPDATE … SET status='failed' WHERE id=? AND status='paid'` first, then `refundPaymentAmount`; on refund error set status back to `paid`, call `sendHotelAlertEmail`, return `'failed_refund_error'`.
  - `handleHotelVerify`: same shape as `handleVerify` in `customTripPayment.ts` (signature → read order from Razorpay → `notes.kind === 'hotel'` → `finalizeHotelBooking`).
  - Webhook: after the custom-trip block in `src/pages/api/webhooks/razorpay.ts` add the same for `notes.kind === 'hotel'` (use `fetchRazorpayOrder` when notes are absent); on `'failed_refund_error'` return 500 so Razorpay retries; GA4 `item_id` fallback `'HOTEL'` for `kind === 'hotel'`.
  - Until Task 13 lands, the success path calls a local `sendHotelEmails` that only logs, so the suite runs.
- [ ] **Step 4:** Run every scratchpad suite (`cust-test`, `pay-test`, hotel suites) → pass. `npx astro check` → 0 errors; `npm run build` passes.
- [ ] **Step 5: Commit** `git add src/lib/hotelbeds.ts src/lib/hotelPayment.ts src/lib/email.ts src/pages/api/hotels/verify.ts src/pages/api/webhooks/razorpay.ts && git commit -m "Hotels: verify payment, book with Hotelbeds, reconcile and refund on failure"`

---

### Task 12: `/hotels/book` — details, review and pay (UI)

**Files:**
- Create: `src/pages/hotels/book.astro`, `src/components/HotelCheckout.tsx`
- Modify: `src/components/HotelSearch.tsx`, `src/i18n/en.ts` (`hotels.checkout{…}`; es/fr/de English placeholders)

**Interfaces:** Consumes `/api/hotels/rate`, `/order`, `/verify`; reuses `PhoneInput` and the Razorpay loader pattern from `TourCustomizer.tsx` (copy `loadRazorpayScript`; declare `Window.Razorpay`).

- [ ] **Step 1:** In `HotelSearch`, "Select" posts to `/api/hotels/rate` with `{rateKey, shownPrice, trip}` and on success stores the `quote` and the `search` in `sessionStorage` (try/catch) and navigates to `/hotels/book?b=<bookingId>`. `book.astro` renders `HotelCheckout` with `bookingId` from the query; the island reads the quote from `sessionStorage` and, if missing, shows `t.checkout.expired` with a link back to `/hotels`.
- [ ] **Step 2:** `HotelCheckout` shows: hotel, room, board, dates, nights, price; the full list of `rateComments`, always visible above the pay button; cancellation terms (free until `<date>`, rendered with `Intl.DateTimeFormat(locale,{timeZone:'Asia/Kolkata'})` and labelled "India time", or non-refundable); a price-changed notice when `quote.changed`; per-room guest name fields (first and last name for each adult and child, child ages read-only); holder email and phone (`PhoneInput`). Pay posts details to `/api/hotels/order`, opens Razorpay, on success posts to `/api/hotels/verify`, then `window.location.href = '/hotels/voucher?booking=' + bookingId`. `not_booked_refunded` shows `t.checkout.refunded`; a verify network failure shows `t.checkout.unconfirmed` with the payment id (same pattern as the tour builder).
- [ ] **Step 3:** Dictionary keys: `checkout{heading,hotel,room,board,dates,nights,total,rateComments,cancellation,freeUntil,nonRefundable,priceChanged,guests,adult,child,age,firstName,lastName,holder,email,phone,pay,opening,confirming,refunded,unconfirmed,expired,gateway,failed,terms}`.
- [ ] **Step 4:** `npx astro check` → 0 errors; `npm run build` passes. Browser harness at 400px: empty submit shows per-field errors, a valid submit sends the exact payload (assert `window.__calls` in the stub), Razorpay opens with prefill, rate comments are visible before the button.
- [ ] **Step 5: Commit** `git add src/pages/hotels/book.astro src/components/HotelCheckout.tsx src/components/HotelSearch.tsx src/i18n && git commit -m "Hotels: details, review and payment page"`
- [ ] **Step 6 (owner):** push after the owner's yes; with the **test** Hotelbeds key and a small Razorpay payment, run one search → pay → booking. Milestone 2 is accepted when a booking reaches `booked` and the forced-failure path (Task 11 case 4, replayed against a deliberately invalid rate key in a staging row) refunds.

---

## Milestone 3 — Voucher, emails, cancellation, admin bookings

### Task 13: Voucher page and emails

**Files:**
- Create: `src/lib/hotelVoucher.ts`, `src/pages/hotels/voucher.astro`
- Modify: `src/lib/email.ts` (`sendHotelVoucherEmail`, `sendHotelAdminEmail`), `src/lib/hotelPayment.ts` (replace the Task 11 logging stub)
- Test: scratchpad `hotel-voucher-test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Voucher { reference: string; ourReference: string; hotelName: string; category: string; address: string; destination: string; phone: string; checkIn: string; checkOut: string; holder: string; rooms: { roomName: string; boardName: string; guests: { name: string; age?: number }[] }[]; rateComments: string[]; payableLine: string }
  export function buildVoucher(row: HotelBookingRow, content: HotelContent | null): Voucher | null
  export function payableLine(supplier: { name: string; vat: string }, reference: string): string
  ```

- [ ] **Step 1: Failing test:** `payableLine({name:'Hotelbeds Spain, S.L.U.',vat:'ESB28916765'},'123-456')` equals exactly `Payable through Hotelbeds Spain, S.L.U., acting as agent for the service operating company, details of which can be provided upon request. VAT: ESB28916765 Reference: 123-456`; `buildVoucher` includes hotel name and address (falling back to the stored `selected_json.hotelName` and "see hotel details" when content is missing — never an empty name), holder, one guest name per room, children's ages, check-in/out, room, board, rate comments; it has **no price field**; returns `null` for a booking that is not `booked`.
- [ ] **Step 2:** Run (fails). **Step 3:** Implement `buildVoucher`/`payableLine` and the page `voucher.astro` (lookup by the unguessable `hb_<uuid>` id; shows the voucher and a Print button; `noindex`; `@media print` styles hide site chrome; a plain message for unknown or not-booked ids). Add the email senders using the existing `post` helper: guest email = voucher summary + link + the payable line; admin email = booking details including net cost and margin. Wire `finalizeHotelBooking` to them; email failures are logged, never thrown.
- [ ] **Step 4:** Run tests; `npx astro check`; `npm run build`. **Step 5: Commit** `git add src/lib/hotelVoucher.ts src/pages/hotels/voucher.astro src/lib/email.ts src/lib/hotelPayment.ts && git commit -m "Hotels: voucher page and emails"`

---

### Task 14: Cancellation and refunds, admin bookings

**Files:**
- Modify: `src/lib/hotelPayment.ts` (`cancelHotelBookingAndRefund`), `src/pages/admin/hotels/index.astro`
- Test: `hotel-pay-test.ts` (extend)

**Interfaces:**
- Produces:
  ```ts
  export async function cancelHotelBookingAndRefund(env: Record<string, any>, db: D1Like, bookingId: string, now?: Date): Promise<{ ok: true; refunded: number; fee: number } | { ok: false; error: string }>
  export function previewHotelRefund(row: HotelBookingRow, now: Date): { refund: number; fee: number }
  ```

- [ ] **Step 1: Failing tests:** before the free deadline → Hotelbeds `DELETE …?cancellationFlag=CANCELLATION` called once, full `refundPaymentAmount(sell_total*100)`, status `cancelled`, `refunded = sell_total`; after the first fee deadline → refund equals `guestRefund(...)` from Task 4, `refunded` stored; after the last deadline (100% fee) → no Razorpay refund call, status `cancelled`, `refunded 0`; calling twice → the second call returns `{ok:true}` with no second Hotelbeds or Razorpay call (claim-first); Hotelbeds cancel fails (HTTP 500) → status back to `booked`, `{ok:false}`; Razorpay refund fails after Hotelbeds cancelled → status stays `cancelled` with `refunded 0`, an alert email goes to the owner, and `{ok:false, error}` says the refund must be done by hand; a booking not `booked` → error; refund never exceeds `sell_total`; `previewHotelRefund` matches what a cancel at the same moment refunds.
- [ ] **Step 2:** Run (fails). **Step 3:** Implement: claim `UPDATE … SET status='cancelled' WHERE id=? AND status='booked'` first; compute fee and refund from `selected_json.cancellation` at `now`; call `cancelHotelBooking`; on failure restore `booked`; on success `refundPaymentAmount` when refund > 0 and store `refunded`; email the guest (refunded amount) and the owner. If the Hotelbeds cancel response carries its own cancellation amount (`booking.hotel.cancellationAmount`), compare it with the computed fee, log both when they differ and use the larger fee (the guest never gets back more than the owner can recover). Confirm the field name against the Task 2 probe.
- [ ] **Step 4: Admin.** In `/admin/hotels` add a bookings table (newest first: status chip, hotel, dates, guest, sell total, refunded) with a **Cancel and refund** button for `booked` rows (confirm dialog showing `previewHotelRefund` for now), and failed or stuck-`paid` rows highlighted with a note to check Razorpay and Hotelbeds.
- [ ] **Step 5:** Run all suites; `npx astro check` → 0 errors; `npm run build`. **Step 6: Commit** `git add src/lib/hotelPayment.ts src/pages/admin/hotels/index.astro && git commit -m "Hotels: cancellation with policy-based refund, admin bookings"`
- [ ] **Step 7 (owner):** push after the owner's yes; on the test key: book, cancel before the deadline, confirm the refund; book a rate with an imminent deadline and confirm the dialog's amount matches what Razorpay refunds.

---

## Milestone 4 — Tour integration, languages, certification, live

### Task 15: Customise-tour hotel step

**Files:**
- Modify: `src/components/TourCustomizer.tsx` (hotel step), `src/pages/customize-your-tour.astro`, `src/pages/customize-your-tour/thanks.astro`, `src/i18n/en.ts` (`customTour.hotel.book*`), `src/lib/hotelSearchService.ts` (none) / `src/components/HotelSearch.tsx` (query prefill)

- [ ] **Step 1:** In the hotel step add a UI-only mode `book` ("Book a hotel for these nights"), shown only when a new `hotelsEnabled` prop (from `isHotelsEnabled` on the page) is true. Choosing it explains that the hotel is a separate booking and payment after the tour deposit. It does not change the tour price or the tour order; it is sent to the server as `own`.
- [ ] **Step 2:** After the tour deposit succeeds, `thanks.astro` shows a "Book your hotel" button linking to `/hotels?checkIn=<startDate>&checkOut=<endDate+1>&adults=<guests>&trip=<tripId>`; `HotelSearch` reads those query values to prefill; `/api/hotels/rate` stores `custom_trip_id` when `trip` is an existing trip id (Task 9 case i).
- [ ] **Step 3:** Add a check to `cust-test.ts` that a trip sent with the UI mode mapped to `own` prices identically to one with `own`.
- [ ] **Step 4:** `npx astro check`; `npm run build`; run `cust-test` and the hotel suites; browser-check the new mode and the thanks link. **Step 5: Commit** `git add src/components src/pages src/i18n && git commit -m "Hotels: book a hotel from the custom tour flow"`

### Task 16: es/fr/de translations

**Files:** Modify `src/i18n/es.ts`, `fr.ts`, `de.ts`; add the new strings to `proofreading/` like earlier features.

- [ ] **Step 1:** Translate every `hotels.*` key and the custom-tour `book*` keys (including the emails and voucher labels; the payable line stays in English because it is the supplier's mandated wording), in the tone of the existing `customTour` sections. Keep placeholders (`{amount}`, `{date}`, `{max}`) unchanged.
- [ ] **Step 2:** `npx astro check` → 0 errors; build. Open `/hotels?lang=es`, `fr`, `de` in the browser harness: no English left, no overflow at 240px.
- [ ] **Step 3:** Add the strings to the proofreading file for the native-speaker pass. **Step 4: Commit** `git add src/i18n proofreading && git commit -m "Hotels: es, fr, de text"`

### Task 17: Certification pack and live rehearsal

**Files:** Create `docs/hotelbeds-certification.md`.

- [ ] **Step 1:** Write the pack Hotelbeds asks for: workflow description (search → CheckRate only for RECHECK → book; one availability call per search), commercial decisions (opaque rates not shown; minimum stars and exclusions from admin; markup applied; our cancellation terms equal Hotelbeds' policy), the demo URL (`https://www.iwisglobal.com/hotels` once the switch is on), test notes (how to book with the test key, where the voucher is), content approach (stored in D1, refreshed weekly by the scheduled workflow; hotels missing from the stored content are not shown), crawler (implemented only if Hotelbeds requests it), and the request email addressed to `apitude@hotelbeds.com`.
- [ ] **Step 2:** Run the **certification scenarios** on the test key and keep the request and response logs with the pack: one room 2 adults; two rooms with different occupancies; children with ages; a RECHECK rate; a BOOKABLE rate (no CheckRate call); cancellation.
- [ ] **Step 3: Commit** `git add docs/hotelbeds-certification.md && git commit -m "Hotels: certification pack"`
- [ ] **Step 4 (owner):** send the certification email. When Hotelbeds issues live keys, replace the three Cloudflare values (`HOTELBEDS_API_KEY`, `HOTELBEDS_SECRET`, `HOTELBEDS_BASE_URL=https://api.hotelbeds.com`), press Refresh content, then do the live rehearsal: book 6 months ahead, 2 adults and 2 children, a refundable rate, send Hotelbeds the voucher and price, then cancel from `/admin/hotels` and confirm the refund and the Hotelbeds cancellation.

---

## Self-review (spec coverage)

- Search/availability/CheckRate/Booking workflow, single availability, RECHECK-only CheckRate: Tasks 5, 7, 9, 11.
- gzip, 60 s+ timeout, signing: Tasks 1, 11.
- Children's ages, multi-room occupancy: Tasks 5, 12.
- Rate comments before payment; cancellation terms in hotel-local terms: Tasks 9, 12.
- Voucher contents and payable line, no price: Task 13.
- Content stored, weekly refresh: Task 6. The spec's hotel-detail fallback is **not** built in v1: a hotel missing from stored content is skipped from results, so no hotel is shown without its content. Record this choice in the certification pack.
- Crawler: deferred until Hotelbeds requests it (Task 17).
- Pricing, markup, FX, rounding, server-only amounts: Tasks 4, 7, 9, 10.
- Pay first, book after, refund on any failure, claim-first, webhook backstop: Tasks 10, 11.
- Cancellation with policy-based refund; admin cancel: Task 14. Guest self-cancel is out of v1 (spec default).
- Admin settings, switch, bookings: Tasks 8, 14. Hidden until switched on: Tasks 7, 8.
- Tour integration with a separate payment: Task 15. Languages: Task 16. Certification and live: Task 17.
- Names used across tasks: `guestPrice`, `cancellationFeeNet`, `guestRefund`, `CancellationPolicy` (Task 4) are imported by Tasks 5, 7, 9, 14; `RateOption`/`HotelResult` (Task 5) feed Task 7; `Quote` (Task 9) feeds Task 12; `finalizeHotelBooking`/`HotelFinalizeOutcome` (Task 11) are what the verify handler and webhook call; `refundPaymentAmount` (Task 10) is used by Tasks 11 and 14; `previewHotelRefund` (Task 14) feeds the admin dialog.
- Risk carried forward: field names in Tasks 5, 9, 11 follow Hotelbeds' documented JSON; Task 2 confirms them against real test responses before Tasks 5–11 are implemented, and any difference is fixed in the task code first.
