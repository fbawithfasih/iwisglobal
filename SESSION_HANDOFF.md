# IWIS Global — Session Handoff

Astro 4 + Cloudflare Pages tour-booking site for IWIS Global (Agra/Taj Mahal
tours). Repo: `github.com/fbawithfasih/iwisglobal` (private). Live at
**www.iwisglobal.com**. Local path: `~/Projects/iwisglobal`.

## 1. What was done (chronological)

1. **Phase 1 — booking site**: Astro scaffold (Cloudflare adapter, React
   islands), Razorpay payment flow (`create-order` → checkout → `verify-payment`
   writes a D1 `bookings` row only after signature verification), tour content
   originally as Markdown content collections, deployed to Cloudflare Pages,
   custom domain `www.iwisglobal.com` wired via Cloudflare DNS (zone already
   on Cloudflare) with a `iwisglobal.com → www.iwisglobal.com` redirect rule.
2. **Live payments**: swapped test keys for live Razorpay keys (KYC/live
   approved by user). Verified via a direct Razorpay API probe that the live
   account accepts **both INR and USD** orders.
3. **Phase 2 — CRM** (`/admin/*`): single-admin password auth (PBKDF2-SHA256
   + signed session cookie, both via Web Crypto — **iteration count capped at
   100,000**, Cloudflare Workers throws `NotSupportedError` above that, unlike
   the more common 210k). Bookings dashboard, itinerary/notes, manual booking
   entry, leads pipeline.
4. **Dynamic tours**: migrated tours from Markdown into D1 (`tours` +
   `tour_addons` tables) so they're manageable from `/admin/tours` without a
   redeploy. Public pages switched from static build to `prerender = false`.
5. **Image upload**: R2 bucket `iwisglobal-images`, admin file upload with
   validation (type/size), served back via `/images/[...key]`.
6. **UI/UX redesign** (competitor research: Headout/GetYourGuide/Klook/
   Viator): violet/purple brand (`brand` = Tailwind `violet`, `accent` =
   `orange`, admin CRM intentionally **left amber/stone**), trust-badge row
   (free cancellation, instant confirmation, pickup, private tour, guide
   language — all real facts, **no fabricated ratings/reviews**), sticky
   booking box, IST-based "Book today/tomorrow" (9 PM IST cutoff).
7. **Dual currency (INR/USD)**: admin sets an explicit USD price per
   tour/add-on (never auto-converted); site-wide currency toggle (cookie-
   persisted); graceful fallback to INR with a visible note when USD isn't
   set for a tour; server independently re-resolves currency+amount at both
   order-creation and verification (client only ever selects a currency).
8. **Logo**: `public/logo.png` (had been referenced since commit 1 but the
   file never existed — was a silent 404 the whole time). Fixed a real
   Chromium PNG-decode bug: the `sips`-converted PNG carried EXIF/XMP
   metadata that made `img.naturalWidth` come back `0` despite valid,
   byte-correct PNG data — re-encoded via Pillow to strip it.
9. **Top nav header**: logo + "IWIS Global" wordmark + Tours link, added to
   `BaseLayout.astro` (renders on every public page).
10. **Headout-style homepage hero**: full-bleed Taj Mahal photo
    (`public/hero-taj-mahal.jpg`), pill-shaped search-styled CTA, 4-column
    trust-badge row — adapted honestly (no fake city grids/testimonials,
    since this is a single-destination operator with zero reviews so far).

## 2. Key files

```
schema.sql, schema_crm.sql, schema_tours.sql, schema_trust_fields.sql,
schema_currency.sql          # D1 migrations, applied in this order, both
                              # local (--local flag) and remote (already applied)
src/lib/
  catalog.ts                 # pure pricing types + computeTotal (currency-agnostic)
  tours.ts                   # D1-backed tour CRUD + getCatalogItem (server price lookup)
  db.ts                      # booking insert/capacity-check
  crm.ts                     # admin booking/lead queries
  currency.ts                # Currency type, resolveCurrency/resolvePrice/resolveAddOns
  availability.ts            # IST 9PM same-day cutoff (getAvailability)
  adminAuth.ts                # PBKDF2 (100k iter!) + session token sign/verify
  requireAdmin.ts, env.ts, images.ts (R2 upload), tourForm.ts (admin textarea encodings)
  payments/{index.ts,razorpay.ts}
src/components/
  TourCard.astro, BookingWidget.tsx, CurrencyToggle.astro
src/pages/
  index.astro, tours/index.astro, tours/[slug].astro, booking/confirmation.astro
  api/{create-order.ts, verify-payment.ts}
  images/[...key].ts          # serves R2 objects
  admin/**                    # login, dashboard, bookings, tours CRUD, leads
public/logo.png, public/hero-taj-mahal.jpg
wrangler.toml                # D1 binding "DB", R2 binding "IMAGES"
```

## 3. Important decisions & constraints

- **No fabricated content, ever**: no fake star ratings/review counts, no
  invented cancellation policy — every trust badge states something real
  and already true (confirmed with the user before building).
- **Cancellation policy**: free cancellation up to 24h before — real,
  site-wide, not per-tour data.
- **Instant confirmation**: real — every online-paid booking writes to D1
  immediately post-signature-verification.
- **Same-day cutoff**: 9 PM IST, computed server-side via
  `Intl.DateTimeFormat(..., {timeZone:'Asia/Kolkata'})` — never the
  visitor's browser-local time.
- **Admin CRM styling is intentionally NOT redesigned** (stays amber/stone);
  only the public site got the violet rebrand.
- **PBKDF2 iterations must stay ≤ 100,000** — Cloudflare Workers' Web Crypto
  hard-limits this.
- **USD prices are never auto-converted** — admin enters them explicitly per
  tour/add-on; a tour without one silently (with a visible note) falls back
  to INR rather than mixing currencies.
- **Never edit/commit `.env`** — gitignored, holds local test Razorpay keys
  + admin auth secrets. Live secrets exist only as Cloudflare Pages secrets
  (`PUBLIC_RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `ADMIN_PASSWORD_SALT`,
  `ADMIN_PASSWORD_HASH`, `ADMIN_SESSION_SECRET`) — **not recorded here**.
  Admin login password was generated once and shown to the user in chat
  only; it is not in this repo. If it's lost, regenerate salt/hash (see
  `.env.example` comment) and reset the Cloudflare secrets + local `.env`.
- **Dev workflow quirk**: `dist/` frequently needs `rm -rf` before
  `npx astro check` — stale build output otherwise pollutes the check with
  unrelated vendor-JS noise.
- **D1 migrations**: always applied twice — once via
  `npx wrangler d1 execute iwisglobal-bookings --local --file=<file>.sql`
  (for local dev), once via the Cloudflare Workers MCP `d1_database_query`
  tool against `database_id: 71733870-0326-4760-b9f6-9c0513a7ce10` (remote/prod).
- Deploy = `npm run build && npx wrangler pages deploy dist --project-name=iwisglobal --branch=main`.

## 4. Current project state

- Live site fully functional: browse tours → book → pay (Razorpay, live
  mode) → confirmation. Admin CRM functional at `/admin`.
- D1 has **one real tour**: `SAME_DAY_AGRA_DELHI` (Same-Day Taj Mahal Tour
  from Delhi), featured, published, INR price set, **USD price NOT set yet**
  (admin needs to add it in `/admin/tours` to enable USD booking for it).
- Cloudflare Pages project: `iwisglobal`. D1: `iwisglobal-bookings`. R2:
  `iwisglobal-images`. All bound in `wrangler.toml`.
- No automated tests exist; `npx astro check` is the only static
  verification step (per project convention).

## 5. Known bugs / unfinished edges

- None currently open — the two real bugs hit this session (excludes never
  rendered; broken logo PNG) were both found and fixed.
- Minor: `admin/bookings/new.astro` (manual booking entry) always creates
  bookings in INR — no currency selector there. Reasonable as-is (phone/
  WhatsApp inquiries), but a gap if the business wants to log a USD manual
  booking.
- Minor: homepage/tour-card images show "No image yet" placeholder for any
  tour without an uploaded/URL image — expected behavior, not a bug.

## 6. What remains / likely next asks

- Admin should set a real USD price for the existing tour (currently blank).
- More tours could be added via `/admin/tours/new` now that it's fully
  self-service (no code changes needed).
- Possible future work flagged during the session but **not started**:
  Stripe as a second payment provider (payments/index.ts was designed to be
  provider-agnostic for this), a per-tour rating/review system (deliberately
  deferred — no reviews exist yet), extending currency selection to manual
  admin bookings, R2 test-image cleanup (a couple of stray tiny test images
  from upload-testing were left in the bucket, harmless/negligible cost).

## 7. Exact next steps (if resuming immediately)

1. `cd ~/Projects/iwisglobal && git pull` to sync (all work is committed and
   pushed — latest commit was the Headout-style homepage hero).
2. If continuing UI work: `npm run dev`, then use the browser tools to
   visually verify — this session's pattern was always: edit → `rm -rf dist`
   → `npx astro check` → local dev server visual check → stop server →
   commit → push → `npm run build` → `wrangler pages deploy` → verify live
   via `curl` (the in-app browser pane's own cache is unreliable for
   before/after comparisons — `curl --resolve www.iwisglobal.com:443:<ip>`
   or a cache-busted `fetch()`/`new Image()` in `javascript_tool` are the
   trustworthy checks).
3. No pending/half-finished edits — working tree was clean as of last commit.
