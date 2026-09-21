# IWIS Global — Session Handoff

Astro 4 + Cloudflare Pages tour-booking site for IWIS Global (Agra/Taj Mahal
tours). Repo: `github.com/fbawithfasih/iwisglobal` (private). Live at
**www.iwisglobal.com**. Local path: `~/Projects/iwisglobal`.

## 1. What was done (chronological)

### Prior sessions (booking platform)

1. **Phase 1 — booking site**: Astro scaffold (Cloudflare adapter, React
   islands), Razorpay payment flow, tour content in D1, deployed to
   Cloudflare Pages, custom domain wired via Cloudflare DNS.
2. **Live payments**: live Razorpay keys, verified both INR and USD orders.
3. **Phase 2 — CRM** (`/admin/*`): single-admin password auth (PBKDF2-SHA256,
   100k iterations — Cloudflare Workers' Web Crypto hard-caps this).
   Bookings dashboard, itinerary/notes, manual booking entry, leads pipeline.
4. **Dynamic tours**: migrated tours from Markdown into D1 so they're
   manageable from `/admin/tours` without a redeploy.
5. **Image upload**: R2 bucket `iwisglobal-images`.
6. **UI/UX redesign**: violet/purple brand, trust-badge row, sticky booking
   box, IST-based "Book today/tomorrow" (9 PM IST cutoff).
7. **Dual currency (INR/USD)**: admin sets explicit USD price per
   tour/add-on (never auto-converted); currency toggle.
8. **Logo + Headout-style homepage hero**, top nav header.
9. **Customer accounts**: Google/Apple SSO (`/login`, `/account/bookings`),
   plus (this session) email/password login — see §2 below.
10. **"Top things to do in Agra" backend** (`/admin/agra-highlights`).

### This session — marketing/growth backlog execution

Working from three files the user supplied
(`.agents/product-marketing-context.md`, `CLAUDE.md`, `docs/execution-backlog.md`
— referenced as "context file" / "backlog" below; not actually committed to
this repo, just used as the task spec). Hard rule followed throughout:
**never invent operational facts** — every price/policy/historical claim is
either sourced (cited inline, mostly to ASI's own site, fetched live) or
explicitly marked `TODO(fasih)`.

**Google/email login, footer, misc (early in session):**
- Fixed Google OAuth (`redirect_uri_mismatch` — the callback URL wasn't
  registered in Google Cloud Console; walked user through fixing it there).
- Added email/password login (`/signup`, `/login`): `src/lib/passwordHash.ts`
  (PBKDF2, extracted from `adminAuth.ts` so both share it),
  `customers.ts` extended, `customerLoginAttempts.ts` rate limiting,
  `schema_customer_email_auth.sql`.
- Redesigned footer (Headout-style multi-column), changed site contact
  email to `info@iwisglobal.com` everywhere.
- Transactional booking-confirmation emails via Resend (`src/lib/email.ts`),
  `RESEND_API_KEY`/`BOOKING_EMAIL_FROM`.

**Phase 0 (pricing/technical):**
- **0.2** Group-size pricing tiers — `tour_pricing_tiers` table,
  `catalog.ts`'s `pickPricingTier`/`perTravelerRate`, admin UI, both tours
  seeded with the backlog's exact tier numbers.
- **0.3** Bundle-by-default add-ons (`tour_addons.included_by_default`) —
  mechanism built and tested; **no add-on seeded** (real monument-entry
  ticket cost not yet supplied by user — add via `/admin/tours`, 4th
  pipe-segment `| yes`).
- **0.4** 25% deposit / balance-on-pickup — `computeDepositAmount()`,
  `bookings.total_amount`/`payment_type`, full booking-widget UI, shown in
  admin + customer views + confirmation email. Manual/phone bookings stay
  full-payment only (by design).
- **0.6** `og:image` — was the square logo; now `public/og-image.jpg`
  (1200×630 crop of the hero photo), wired as `BaseLayout`'s default.
- **0.7** `public/robots.txt` — was completely absent; now a permissive
  `User-agent: *` block + sitemap reference.
- **0.1, 0.5** still open — need real business facts from user (see §5).

**Phase 1 (trust):**
- **1.2** WhatsApp review-request flow — `bookings.review_requested_at`,
  new `/admin/reviews` (lists completed trips due for a request, one-click
  wa.me link, "mark as sent").
- **1.6** `/no-commission-pledge` — real content, sourced to the context
  file's already-confirmed differentiator.
- **1.7** `/reviews` — honest empty state, **no** `AggregateRating` schema
  (no real reviews exist yet).
- **1.3–1.5** GBP Q&A / setup checklist / TripAdvisor listing copy drafted
  in `docs/gbp-tripadvisor-content.md` — manual dashboard actions, user's
  to paste in.
- **1.1** (founding-guest offer) — skipped, needs real terms from user.

**Phase 2 (extraction/SEO/analytics):**
- **2.1** Schema markup — `Organization`+`TravelAgency` merged with
  category-disambiguated name + real `sameAs` (user's GBP link), `Product`
  added to tour pages (alongside existing `TouristTrip`), `FAQPage` on
  `/help`. Address only carries confirmed facts (locality/region/country —
  no street address exists anywhere, same gap as 0.5).
- **2.6** Five Viator-FAQ counter-pages under `/guides` — new content
  collection (`src/content/guides/`), each with `Article` schema, sourced
  to ASI/IMD/IQAir. First real content in this repo.
- **2.8** GTM (`GTM-KCCT2CSW`) + GA4 gtag.js (`G-3CCCVSYT7D`) installed.
  Server-side `purchase` event via Razorpay webhook
  (`src/pages/api/webhooks/razorpay.ts`) — signature-verified, idempotent
  (`analytics_events_sent` table), fully configured and **live** (all three
  secrets set: `RAZORPAY_WEBHOOK_SECRET`, `GA4_MEASUREMENT_ID`,
  `GA4_API_SECRET`). Client-side dataLayer events: `tour_viewed`,
  `availability_checked`, `checkout_started`, `payment_initiated`,
  `currency_switched`, `language_switched`, `whatsapp_clicked`.
- **2.9** Unique `wa.me` ref per page/location on all 6 WhatsApp links
  site-wide.
- **2.4** Both tour pages expanded to 800+ words (real content, written
  directly into D1 `tours.description` — no deploy needed for that part).
- **2.5** Title tags audited — only the homepage was brand-first; fixed.
- **2.7** Four Agra attraction pages (`/agra/taj-mahal`, `/agra/agra-fort`,
  `/agra/fatehpur-sikri`, `/agra/mehtab-bagh`) — new content collection
  (`src/content/attractions/`), `TouristAttraction` schema. Homepage's
  "Top things to do in Agra" cards now link to these instead of a generic
  `/tours` page.
- **2.2, 2.3** still open (`llms.txt` not built; language routing
  explicitly "hold" per the user's own backlog).

## 2. Key files

```
schema.sql, schema_crm.sql, schema_tours.sql, schema_trust_fields.sql,
schema_currency.sql, schema_customer_email_auth.sql,
schema_group_pricing.sql, schema_analytics.sql, schema_review_requests.sql,
schema_deposit_payments.sql        # D1 migrations, applied in this order,
                                    # both local (--local) and remote
src/lib/
  catalog.ts                 # pricing (tiers, deposit calc) — currency-agnostic
  tours.ts                   # D1-backed tour CRUD + getCatalogItem
  db.ts                      # booking insert/capacity-check
  crm.ts                     # admin booking/lead/review-request queries
  currency.ts                # Currency resolution, resolveFromPrice
  passwordHash.ts             # shared PBKDF2 (admin + customer auth)
  adminAuth.ts, customerAuth.ts, customerLoginAttempts.ts, loginAttempts.ts
  requireAdmin.ts, requireCustomer.ts, env.ts, images.ts
  email.ts                   # Resend transactional email
  payments/{index.ts,razorpay.ts}
src/components/
  TourCard.astro, BookingWidget.tsx, CurrencyToggle.astro, LocaleSwitcher.astro
src/content/
  config.ts                  # guides + attractions collections
  guides/*.md                 # 5 Viator-FAQ counter-pages
  attractions/*.md             # 4 Agra attraction pages
src/pages/
  index.astro, tours/index.astro, tours/[slug].astro, booking/confirmation.astro
  login.astro, signup.astro, no-commission-pledge.astro, reviews.astro
  guides/index.astro, guides/[slug].astro, agra/index.astro, agra/[slug].astro
  api/{create-order.ts, verify-payment.ts, webhooks/razorpay.ts}
  images/[...key].ts
  admin/**                    # login, dashboard, bookings, tours, leads, reviews
public/logo.png, public/hero-taj-mahal.jpg, public/og-image.jpg, public/robots.txt
docs/gbp-tripadvisor-content.md    # ready-to-paste, manual dashboard actions
wrangler.toml                # D1 binding "DB", R2 binding "IMAGES"
astro.config.mjs             # sitemap customPages for /guides + /agra dynamic routes
```

## 3. Important decisions & constraints

- **No fabricated content, ever** — extended this session to: real ASI/IMD
  sourcing for all new content, `TODO(fasih)` markers on anything
  unverifiable (Mehtab Bagh's ticket price, monument-entry add-on cost,
  cloakroom procedure, tripod-permission process), never a fabricated named
  author (guides/attractions byline "IWIS Global", not an invented person).
- **PBKDF2 iterations must stay ≤ 100,000** (Cloudflare Workers cap).
- **USD prices/tiers are never auto-converted** — admin sets explicitly.
- **Deposit non-refundable within 24h** — policy statement only, no new
  automated refund/cancellation logic (cancellations are still all-manual,
  matching the existing pattern).
- **Dynamic routes don't appear in sitemap.xml automatically** —
  `astro.config.mjs`'s `customPages` fixes this for `/guides/[slug]` and
  `/agra/[slug]` (both content-collection-backed, known at build time).
  `/tours/[slug]` has the same gap but is D1-backed — not fixed (would need
  a build-time DB query), flagged as a known follow-up.
- **Never edit/commit `.env`** — gitignored. Production secrets set via
  `wrangler pages secret put`, not recorded here. Current production
  secrets: `PUBLIC_RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`,
  `ADMIN_PASSWORD_HASH/SALT`, `ADMIN_SESSION_SECRET`,
  `CUSTOMER_SESSION_SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `RESEND_API_KEY`,
  `RAZORPAY_WEBHOOK_SECRET`, `GA4_MEASUREMENT_ID`, `GA4_API_SECRET`.
- **D1 migrations**: applied twice — local (`wrangler d1 execute
  iwisglobal-bookings --local --file=<file>.sql`) and remote (Cloudflare
  Workers MCP `d1_database_query`, `database_id:
  71733870-0326-4760-b9f6-9c0513a7ce10`).
- **This repo has no CI** — pushing to GitHub does *not* auto-deploy.
  Deploy is always manual: `rm -rf dist && npm run build && npx wrangler
  pages deploy dist --project-name=iwisglobal --branch=main`. (A sibling
  project of the user's, hivemindnestor, does have CI — don't confuse them.)
- Session's verification pattern throughout: `rm -rf dist` → `npx astro
  check` → local dev server + real browser check (claude-in-chrome) →
  commit → push → build → deploy → verify live via curl/browser again.

## 4. Current project state

- Live site fully functional: browse tours → book (full or 25% deposit) →
  pay (Razorpay, live mode) → confirmation email. Admin CRM functional,
  now including a Reviews tab.
- D1 has **two tours**, both with full pricing tiers, USD prices, and
  800+-word descriptions: `SAME_DAY_AGRA_DELHI`, `TAJ_MAHAL_SUNRISE_TOUR`.
- **Zero real bookings exist in production yet** (confirmed via query this
  session) — the deposit/analytics/review-request features are all built
  and verified but not yet exercised by a real customer.
- GTM + GA4 fully installed and live; the purchase-tracking webhook is
  fully configured (all 3 secrets set) but hasn't fired on a real payment
  yet, same reason.
- Sitewide content now includes 5 guides, 4 attraction pages, a
  no-commission pledge page, and an honest reviews page — up from just the
  tour pages + legal pages at session start.

## 5. What remains / likely next asks

**Needs the user's input (not code-blocked):**
- 0.1: confirm whether ₹8,999/vehicle cost includes the guide, and whether
  it holds for the sunrise departure.
- 0.3: real at-cost monument-entry ticket price, to seed the bundled add-on.
- 0.5: `/about` page — needs real legal entity name, Agra street address,
  registration/licence numbers, GST. Currently nothing published anywhere.
- 1.1: founding-guest offer terms (price, slot count, deadline) if the user
  wants to run it.
- GBP/TripAdvisor: user needs to paste `docs/gbp-tripadvisor-content.md`'s
  content into those dashboards manually (no API access exists).
- Mehtab Bagh's exact current ticket price (flagged `TODO(fasih)` on that
  page).

**Buildable, not yet started:**
- 2.2: `llms.txt`.
- Phase 3/4 (Marriott Bonvoy, Project Expedition, OTA listings, concierge
  outreach) — mostly manual business dev, not code.
- `/tours/[slug]` sitemap gap (D1-backed dynamic route, same issue
  `/guides`/`/agra` had — would need a build-time DB query to fix).

**Explicitly deferred by the user's own backlog:**
- 2.3: language routing (`/es/` etc.) — "hold until source markets are
  validated."

## 6. Exact next steps (if resuming immediately)

1. `cd ~/Projects/iwisglobal && git pull` (all work committed and pushed).
2. Remember: **no CI** — a push alone does not update the live site. Always
   follow with the manual build+deploy sequence in §3 if code changed.
3. If continuing backlog work, re-read `docs/execution-backlog.md` (the
   original file supplied by the user, not committed here) for what's left,
   or ask the user directly — most remaining items need real facts only
   they have.
