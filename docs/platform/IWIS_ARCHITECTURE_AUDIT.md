# IWIS Architecture Audit

Date: 26 October 2026. Scope: the `fbawithfasih/iwisglobal` repository at `main` (commit `5af4ea9` and later) and the live D1 database in read-only mode.

**How to read this document.** Every statement is tagged. **[Verified]** means I read the code or queried the live database during this audit. **[Assumed]** means it is an inference I could not confirm from the repository. Nothing here was changed in production.

**What I did not do:** no load or performance testing, no security penetration testing, no review of Cloudflare or GitHub account settings, no review of every admin screen visually. Those are listed under "Not yet audited" at the end.

---

## 1. What IWIS is today

IWIS is two things in one codebase: a public tour-booking website (www.iwisglobal.com) and a private admin area (`/admin`) that the business owner uses to run bookings, leads, WhatsApp, marketing and content.

| Item | Finding |
|---|---|
| Framework | Astro 4 with server rendering, React 18 islands for interactive parts **[Verified]** |
| Styling | Tailwind CSS 3, `brand` = Tailwind violet, `accent` = orange reserved for offers **[Verified]** |
| Hosting | Cloudflare Pages (Direct Upload project), deployed by a GitHub Action on every push to `main` **[Verified]** |
| Database | Cloudflare D1 (SQLite), read replication enabled; 44 `schema_*.sql` files applied by hand **[Verified]** |
| Files | Cloudflare R2 (tour/blog images, WhatsApp media) **[Verified]** |
| Email | Resend (transactional and marketing) **[Verified]** |
| Payments | Razorpay (INR and USD) **[Verified]** |
| Messaging | WhatsApp Cloud API webhook, Meta lead ads / Instagram / Messenger webhook **[Verified]** |
| Analytics | GA4 (browser tag plus server-side purchase), Meta Conversions API **[Verified]** |
| Size | 121 route files (48 under `/admin`), 97 library modules, 35 components **[Verified]** |
| Scheduled work | 4 GitHub Actions cron workflows call protected endpoints (campaign send, leads digest, Meta lead poll, hotel sync). Pages has no native cron **[Verified]** |
| Tests | 11 Node test suites in `scripts/contacts-test`, run by hand with `sh scripts/contacts-test/run.sh` **[Verified]** |

### Data scale (live D1, 26 Oct 2026) **[Verified]**

| Table | Rows |
|---|---|
| bookings | 5 |
| leads | 23 |
| people | 21 |
| lead_activities | 48 |
| WhatsApp conversations / messages | 11 / 110 |
| tours | 12 |
| admin push subscriptions | 2 |
| distinct `leads.owner` values | 1 |
| distinct `lead_activities.created_by` values | 3 (empty, `admin`, `backfill`) |

This is a small business with one operator. That matters for scope: see the blueprint's "right-sizing" section.

---

## 2. Admin modules inventory **[Verified]**

| Module | Routes | What it does | Notes |
|---|---|---|---|
| Bookings | `/admin`, `/admin/bookings/*` | List, detail, status, notes, tickets, manual booking | `bookings/[id].astro` is 510 lines |
| Leads | `/admin/leads/*` | One inbox for every channel, stages, notes, follow-ups, merge, import/export, report, subscribers, Meta status | Built this month on top of `people`, `touchpoints`, `consent_events` |
| Campaigns | `/admin/campaigns/*` | Email campaigns, test send, audience, preview | Sending is disabled until `MARKETING_SENDING_ENABLED=1` |
| WhatsApp | `/admin/whatsapp/*` | Inbox, auto-reply drafts, knowledge base, launch readiness | `whatsapp/index.astro` is 513 lines |
| Tours | `/admin/tours/*` | Tours, prices, add-ons, group tiers, images | |
| Hotels | `/admin/hotels/*` | Hotelbeds search, preview, booking | |
| Custom trips | `/admin/custom-trips` | Quotes and payment links | |
| Offers / Private offers | `/admin/offers/*`, `/admin/private-offers` | Coupons, countdown offers, one-to-one offers | |
| Content | `/admin/blog/*`, `/admin/agra-highlights/*`, `/admin/reviews` | Blog, "things to do" cards, review moderation | |
| Admin APIs | `/admin/api/*` | Hotel search/rate/order, push subscribe/test, WhatsApp poll and media | |

Public API routes under `/api/*` (26 files) handle payments, webhooks (Razorpay, WhatsApp, Meta, Resend), lead capture, subscription, and cron endpoints protected by shared secrets.

---

## 3. Identity and access control today

### 3.1 How admin login works **[Verified]**

- One shared password. Its PBKDF2 hash and salt live in Cloudflare secrets (`ADMIN_PASSWORD_HASH`, `ADMIN_PASSWORD_SALT`). There is no user table for staff.
- A successful login sets a signed cookie `admin_session`: the value is an expiry time and an HMAC of it (`ADMIN_SESSION_SECRET`). Lifetime 12 hours, `httpOnly`, `secure`, `sameSite=lax`, path `/admin`.
- There is no server-side session store. The cookie carries no user identity.
- Login attempts are limited per IP address: 5 failures in 15 minutes locks that IP for 15 minutes.
- Logout deletes the cookie in the browser only.

### 3.2 How admin routes are protected **[Verified]**

- Each admin page and admin API repeats the same few lines at the top: call `isAdminAuthenticated`, redirect to `/admin/login` (or return 401) if false. All 46 admin route files except `login.astro` and `logout.astro` do this; six public pages (`/hotels`, `/hotels/book`, `/customize-your-tour` and three `/api/hotels/*` routes) also call it to show admin-only extras.
- `src/middleware.ts` does not check authentication. It handles language routing and database sessions only.
- There is no role, permission, or record-level check anywhere. Anyone with the cookie can do everything, including exports, sending campaigns, changing prices and viewing WhatsApp conversations.

### 3.3 Accountability **[Verified]**

- No admin audit log table exists.
- `lead_activities.created_by` is always the literal string `admin` (or `backfill` for the system import). `consent_events.entered_by` and `merge_log` exist but record the same generic actor.
- A CSV export of every lead (up to 20,000 rows, includes names, emails, phones) is not logged anywhere.

---

## 4. Findings

Severity is my judgement for a business that handles customer names, phone numbers, emails, WhatsApp conversations and payment-linked bookings.

### Security and governance

| ID | Finding | Severity | Status |
|---|---|---|---|
| S1 | **One shared admin password, no individual accounts.** Nobody else can be given access without sharing the password, and nothing records who did what. | High (as soon as a second person works in admin) | **[Verified]** |
| S2 | **No way to revoke a session.** A stolen or copied cookie works until it expires (up to 12 hours). The only emergency lever is rotating `ADMIN_SESSION_SECRET`, which logs out everyone and also changes the fallback secret for offer timers (S8). | Medium | **[Verified]** |
| S3 | **Authentication is opt-in per file, not deny-by-default.** A new admin page that forgets the check is publicly reachable. | High (design risk, no current gap found) | **[Verified]** that all 46 existing protected admin files call the check |
| S4 | **No second factor** on the admin login. | Medium | **[Verified]** |
| S5 | **Login throttling is per IP only.** Because the password is shared and single, an attacker rotating IP addresses is not slowed by account lockout. PBKDF2 is capped at 100,000 iterations by the Workers runtime (documented in `adminAuth.ts`). | Medium | **[Verified]** |
| S6 | **No CSRF token on admin forms.** Mitigated today by `sameSite=lax` and the `/admin` cookie path: cross-site POSTs do not carry the cookie. The pages I sampled (leads, login, logout) only change data on POST. A full sweep for any state change on GET has not been done. | Low to medium | **[Verified]** for the sample, **[Assumed]** for the rest |
| S7 | **No audit trail** for sensitive actions (exports, role-like changes, price changes, campaign sends, lead merges are recorded without a real actor). | High once there is a team | **[Verified]** |
| S8 | **Secret reuse:** `OFFER_TIMER_SECRET` falls back to `ADMIN_SESSION_SECRET` (`src/lib/offerTimer.ts`). The two HMACs sign different message formats, so there is no known practical attack, but one secret should not serve two purposes. | Low | **[Verified]** |
| S9 | **Customer data in admin has no field-level restriction.** Every logged-in admin sees full phone numbers, emails and message content. Fine for one owner; not acceptable for a larger team without roles. | Depends on the team | **[Verified]** |

### Engineering and delivery

| ID | Finding | Severity | Status |
|---|---|---|---|
| E1 | **No automated checks in CI.** The only workflow that runs on pushes builds and deploys; nothing runs `astro check` or the test suites. Pull requests show only the GitGuardian secret scan. Checks have been run by hand before each merge. | High | **[Verified]** |
| E2 | **No tests for authentication or authorization.** The 11 suites cover contacts, email, campaigns, WhatsApp, offers, events and booking logic. | High for the planned work | **[Verified]** |
| E3 | **Large page files mix data access, form handling and markup** (`whatsapp/index.astro` 513 lines, `bookings/[id].astro` 510, `leads/[id].astro` 247, `campaigns/[id].astro` 247). | Medium | **[Verified]** |
| E4 | **Schema changes are hand-applied SQL files** with no migration table, so there is no record of which file ran where. They have been applied one at a time, always before deploy, on the owner's explicit yes. | Medium | **[Verified]** |
| E5 | **No staging environment** noted in the repository. All verification happens on a local copy or on production. | Medium | **[Assumed]** (could not see Cloudflare project list) |
| E6 | **Constraints any design must respect:** Workers runtime (no Node APIs, PBKDF2 ≤ 100k iterations); D1 read replicas (admin paths are pinned to the primary database in `middleware.ts`, new admin routes must stay inside `PRIMARY_PATHS`); Pages Direct Upload deploys; no native cron. | Informational | **[Verified]** |

### UI/UX and accessibility (admin)

| ID | Finding | Status |
|---|---|---|
| U1 | **Admin styling is applied by CSS overrides in `AdminLayout.astro`**: about a dozen rules such as `main .bg-amber-800 { gradient … }` turn the amber classes that individual pages still use into violet. Pages are written against one palette and recoloured by another. | **[Verified]** |
| U2 | **Navigation is a top bar** with four daily links and two dropdown groups (Sell, Content). It works on a phone (the owner uses it as a Home Screen app) but has no search, no breadcrumbs, no notifications area, no user menu. | **[Verified]** |
| U3 | **No shared component layer for admin.** Buttons, tables, badges and forms are repeated utility-class strings in each page. | **[Verified]** by reading the layout and sampled pages |
| U4 | **Accessibility basics are partial.** The layout has 7 `aria-` attributes, no skip-to-content link, and relies on the browser default for focus on dropdowns. Contrast and keyboard behaviour of individual pages were not tested. | **[Verified]** for the layout, **[Not audited]** for pages |
| U5 | **Data tables are not responsive in a consistent way** (some pages use cards on phones, others scroll horizontally). | **[Assumed]** from the sampled pages |

### Performance **[Not measured]**

I did not measure admin page speed. Two things are known: the middleware pins admin to the primary D1 database (correct for read-after-write, costs latency from distant locations), and the home page batches its D1 queries (already optimised). Anything beyond that would be guessing, so the roadmap makes measurement a first step.

---

## 5. Unknowns that affect the plan

1. How many people will use admin, and in what jobs (sales/WhatsApp replies, operations, guides, drivers, accountant)?
2. Which data must some staff never see (payments, customer phone numbers, full WhatsApp history)?
3. Whether the Cloudflare account has Zero Trust / Access enabled and on which plan (see the blueprint's login options).
4. Whether the owner wants to keep using admin as a phone Home Screen app after a sidebar redesign.
5. Whether any staff beyond the owner exist today (the data suggests not).

## 6. Not yet audited

- Every admin page's mobile layout and keyboard behaviour.
- A full sweep of admin routes for state-changing GET requests.
- Cloudflare account settings (WAF, Access, secrets inventory, backups / D1 Time Travel retention).
- Backup and restore procedure for D1 and R2.
- Dependency vulnerability scan (`npm audit`).
- Admin performance under realistic data volumes.
