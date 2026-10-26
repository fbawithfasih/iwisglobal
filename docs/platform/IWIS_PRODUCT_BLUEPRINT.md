# IWIS Product Blueprint

Date: 26 October 2026. Companion to `IWIS_ARCHITECTURE_AUDIT.md`. This is a **proposal for approval**. Nothing here has been built, migrated or deployed.

---

## 1. Right-sizing the brief

The master brief describes an enterprise platform with departments, scoped record visibility, custom roles, management dashboards and a full design system. The audit shows IWIS today is one operator, 5 bookings, 23 leads, 11 WhatsApp conversations, and a single shared admin password.

So I propose to build **in the order the risk dictates, not the order of the brief**:

| Tier | What | Why now |
|---|---|---|
| **A. Do first** | Automated checks in CI, backup/restore baseline, deny-by-default admin gate, individual staff accounts, five fixed roles, audit log | Closes S1, S3, S7, E1, E2 from the audit. Needed before a second person touches admin. |
| **B. Do next** | New admin shell (sidebar, search, notifications, "Today" home), small shared component library, design tokens, accessibility baseline | The visible modernisation. Safe once Tier A is in place. |
| **C. Do when the team exists** | Departments, record-level scopes ("only my leads"), custom role editor, manager dashboards | Built on real requirements from real staff. Building them now would be guessing, and untested permission logic is a liability. |

Tier C is **deferred, not dropped**. The schema in section 4 leaves room for it.

---

## 2. The ten highest-value improvements

Ranked by value for this business, with the audit finding each one closes.

| # | Improvement | Closes |
|---|---|---|
| 1 | Individual staff accounts, roles and an audit log | S1, S7, S9 |
| 2 | CI that runs type check, build and the test suites on every pull request | E1, E2 |
| 3 | One deny-by-default gate for `/admin` and `/admin/api`, so a forgotten check can never expose a page | S3 |
| 4 | **"Today" home page** replacing the bookings list as the landing page: tours running today and tomorrow, WhatsApp chats awaiting a reply, new leads with no first response, follow-ups due. Every number comes from tables that already exist. | U2 |
| 5 | Sidebar shell with global search and a notifications bell (new WhatsApp message, new lead, follow-up due; push notifications already exist) | U2 |
| 6 | Design tokens and a small shared component set, retiring the dozen or so CSS override rules in `AdminLayout.astro` | U1, U3 |
| 7 | Consistent list pages: filters, pagination, saved views, card layout on phones (the leads list is the template) | U5 |
| 8 | One standard for destructive actions: confirm dialog, typed confirmation for irreversible ones, audit entry (WhatsApp chat deletion already works this way) | S7 |
| 9 | Split the four 250 to 500 line pages into data functions in `src/lib` plus components, one page at a time, behaviour unchanged | E3 |
| 10 | Accessibility baseline: skip link, visible focus, labelled controls, contrast checks, reduced motion | U4 |

---

## 3. Navigation, mapped to what actually exists

The brief's generic structure includes modules IWIS does not have (opportunities, documents, departments reports). This map uses only real modules.

```
Today                      (new home)
Customers
  Leads                    /admin/leads
  WhatsApp                 /admin/whatsapp
  Subscribers              /admin/leads/subscribers
  Reviews                  /admin/reviews
Sales
  Bookings                 /admin/bookings, /admin
  Custom trips             /admin/custom-trips
  Hotels                   /admin/hotels
  Tours                    /admin/tours
  Offers                   /admin/offers, /admin/private-offers
Marketing
  Campaigns                /admin/campaigns
  Blog                     /admin/blog
  Agra highlights          /admin/agra-highlights
Insights
  Lead report              /admin/leads/report
Team                       (new, owner only at first)
  Members, Roles, Audit log
```

On phones the sidebar becomes a slide-over drawer, and the existing Home Screen app (`/admin.webmanifest`) keeps working. Items a person cannot use are hidden, **and** refused by the server (section 4.4): hiding is never the control.

---

## 4. Access control proposal

### 4.1 Three ways to sign staff in

| Option | How it works | Good | Watch out |
|---|---|---|---|
| **A. Cloudflare Access in front of `/admin`** | Cloudflare checks identity (Google, email code, MFA) before the request reaches the app. The app reads and verifies the `Cf-Access-Jwt-Assertion` header and maps the email to a staff record. | MFA and session revocation handled by Cloudflare; no staff passwords in our database | Needs Zero Trust enabled; I have **not** confirmed the plan or user limit; Access login inside the phone Home Screen app is **unverified**; Cloudflare's own docs say the JWT must be validated by the app |
| **B. Own email + password + authenticator app** | We build accounts, password reset, TOTP enrolment, brute-force controls | Self-contained | Largest build and the most security-sensitive code to own; PBKDF2 is capped at 100,000 iterations on Workers |
| **C. "Sign in with Google" for invited staff, server-side sessions** | Reuse the Google sign-in code already written for customers (`src/lib/oauth/google.ts`). Only emails that were invited can sign in. Sessions are stored in D1, so they can be revoked. | No staff passwords; Google enforces 2-step verification if the account has it; revocation works; least new code | Staff need Google accounts; a new redirect URI must be registered in Google Cloud Console |

**Recommendation: C**, with A as an optional later layer. It removes the shared password, gives per-person accountability, supports revocation, and reuses proven code. The existing password login stays as an owner-only **break-glass** route until the new login is proven (section 4.5).

### 4.2 Data model (sketch only, not applied)

New tables, all additive. Existing tables are unchanged apart from one nullable column.

```
staff_users            id, email (unique), name, status [invited|active|suspended], created_at, last_login_at, invited_by
staff_roles            id, key (unique), name, is_system
staff_role_permissions role_id, permission            -- "resource:action"
staff_user_roles       user_id, role_id
staff_sessions         id (hash of token), user_id, created_at, expires_at, revoked_at, ip, user_agent
staff_invites          token_hash, email, role_id, expires_at, used_at, invited_by
admin_audit_log        id, at, actor_user_id, actor_email, action, resource, resource_id, summary, ip, meta_json
```

- `admin_audit_log` is append-only: no code path updates or deletes rows, and a database trigger rejects `UPDATE` and `DELETE`.
- `leads.owner` (a text column that exists today) can later point at `staff_users.id` for "assigned to".
- Departments and scopes (Tier C) would add `departments`, `staff_user_departments` and an `owner_id` filter. Nothing here blocks that.

### 4.3 Permission catalogue (derived from the real modules)

Format `resource:action`. High-impact actions are separate permissions on purpose.

| Resource | Actions |
|---|---|
| bookings | read, create, update, export |
| leads | read, create, update, assign, merge, import, export |
| subscribers | read |
| people | erase (GDPR deletion, owner only by default) |
| whatsapp | read, reply, delete, autoreply_manage, knowledge_manage |
| campaigns | read, edit, **send** |
| tours | read, edit (prices), publish |
| hotels | search, book |
| custom_trips | read, quote |
| offers | read, manage (coupons change prices) |
| content | blog_edit, blog_publish, highlights_edit, reviews_moderate |
| reports | read |
| team | read, invite, manage_roles, suspend |
| audit | read |
| settings | update |

### 4.4 Default roles (proposal, pending question 1)

| Role | Gets |
|---|---|
| **Owner** | everything; cannot be removed; at least one active owner must always exist |
| **Operations** | bookings, custom_trips, hotels, tours (read), reports |
| **Sales & Support** | leads, whatsapp (read, reply), bookings (read, create), custom_trips (read, quote) |
| **Content & Marketing** | content, campaigns (read, edit; **not send**), subscribers (read), offers (read) |
| **Read-only** | read permissions only; no exports |

### 4.5 How it is enforced and rolled out safely

1. **Single gate.** `src/middleware.ts` checks every request to `/admin` and `/admin/api`: valid staff session or the legacy owner cookie, otherwise redirect or 401. The login pages are the only exceptions. Because Astro 4 has known advisories where encoded paths bypass authentication written in middleware (audit S11), the gate is **a second layer**: every route keeps its own check until Astro is upgraded (M0b), and the route-inventory test enforces both.
2. **Deny by default.** A route table maps each path prefix to the permission it needs. A path with no entry is refused for everyone except Owner. A new page therefore fails closed.
3. **One authorization function.** `authorize(principal, permission)` in a single library file is the only place permission logic lives; routes and the sidebar both call it.
4. **Legacy compatibility.** The current cookie is treated as the Owner principal, so the first deploy of the gate changes nothing for you.
5. **No lockout.** The owner password route stays until staff login has been used successfully in production; after that it becomes owner-only, rate-limited, and every use writes an audit entry and a push notification.
6. **Audit from day one.** Exports, campaign sends, lead merges, GDPR erasures, price and offer changes, role and permission changes, suspensions and break-glass logins each write one audit row with a real actor.
7. **Tests before exposure.** A test enumerates every file under `src/pages/admin` and fails if any route is reachable without a session. Further tests cover each default role against the permission catalogue, role escalation attempts, suspended users and revoked sessions.

---

## 5. Design system

### 5.1 Palette

The public site and admin already use the Tailwind **violet** scale (theme colour `#6d28d9`, admin bar `#4c1d95`). The brief proposes `#6D4AFF`, a bluer purple. I recommend **keeping the current violet as the brand** (the logo, the public site and the customer emails already use it) and adding the brief's pastels as semantic surface tokens. If you prefer `#6D4AFF`, tokens make it a one-line change.

| Token | Value | Use |
|---|---|---|
| `--brand-600` | `#6d28d9` (existing) | primary buttons, links, active state |
| `--brand-300` | `#a78bfa` | borders, focus ring, charts; **fills only, never text** |
| `--bg` | `#f8f9fc` | page background |
| `--surface` | `#ffffff` | cards, tables |
| `--text` | `#1e1b2e` | primary text |
| `--text-muted` | `#64748b` | secondary text |
| `--info-bg` | `#dbeafe` | informational badges |
| `--success-bg` | `#d1fae5` | success and "paid" badges |
| `--warn-bg` | `#ffedd5` | follow-ups due, attention |
| `--danger-bg` | `#ffe4e6` | errors, destructive confirmations |
| `--offer-*` | rose to orange (existing `accent`) | offers and coupons only, as on the public site |

**Contrast (my hand calculation, to be confirmed with a checker in Milestone 1):** white on `#6D4AFF` is about 5.1:1 and white on `#6d28d9` is higher, both passing AA. `#a78bfa` with white text is about 2.7:1, so **it must not carry text**. `#64748b` on `#f8f9fc` is about 4.5:1, which passes with no margin, so use `--text` on pastel fills and reserve `--text-muted` for the page background.

### 5.2 Typography, spacing, motion

- One sans family for admin (Inter or the system UI stack, to avoid new font downloads on phones); the public site's serif stays on the public site.
- 4-pixel spacing scale, radius tokens (6, 10, 16, full), three shadow levels.
- Motion 150 to 250 ms, disabled under `prefers-reduced-motion`.

### 5.3 Components (built only as pages need them)

Button (primary, secondary, danger), field and label, select, badge, card, data table with phone card layout, tabs, confirm dialog, slide-over, toast, empty state, skeleton, permission-aware menu item. Implemented as Astro components with React only where interaction needs it, using the existing Tailwind setup (no new UI framework).

---

## 6. Roadmap

Each milestone ships as small pull requests and is verified before the next starts. Schema changes follow the existing rule: applied to production only after your explicit yes, before the code that needs them is deployed.

| # | Milestone | Deliverables | Acceptance criteria | Depends on | Main risk |
|---|---|---|---|---|---|
| **M0** | Safety baseline | **Done:** admin route sweep (no state change on GET), `npm audit` analysis, block of the unused `/_image` endpoint (audit S10). **Done in this PR:** CI on pull requests (type check, build, all test suites; `.github/workflows/ci.yml`), tested D1 backup and restore tools and the written procedure (`docs/platform/IWIS_BACKUP_AND_RECOVERY.md`), restore rehearsed on a local copy of the production schema. **Still to do (needs the owner):** one real export from production with the owner's Cloudflare login, restore of it into a throwaway database, R2 backup, and admin page timing (needs a logged-in session) | Every PR shows the checks; a restore from export is proven locally | none | CI minutes or flaky tests; low |
| **M0b** | Framework upgrade | **Step 1 done (this PR):** Astro 5.18 and adapter 12.6, which stay on Pages; `output` set to `static` (Astro 5 meaning of hybrid), image service passthrough (keeps `sharp` out of the Worker bundle). **M0c (decision needed):** Astro 6/7 need adapter 13+, which no longer supports Pages and means moving hosting to a Worker. Removes the remaining audit S11 findings | `npm audit` shows no critical or high findings in production dependencies; every public and admin page behaves as before | M0 | Breaking changes in rendering, middleware and the adapter; mitigated by doing it alone, in small steps, with CI in place |
| **M1** | Design foundation and shell | **Step 1 done (this PR):** design tokens as CSS variables, left sidebar (desktop) and slide-over drawer (phone) in one component, skip link, visible focus rings, reduced-motion support; every admin page picks it up through `AdminLayout`. **Step 2 done (this PR):** shared component classes (`btn-primary`, `btn-secondary`, `btn-danger`, `badge-*`), a living `/admin/style-guide` page, the amber/stone overrides replaced by exact violet equivalents in all pages (verified: computed styles of 7,060 elements on 29 pages at two widths unchanged), axe-core WCAG A/AA check clean on 11 pages, muted text darkened from 4.4:1 to 5.3:1, missing labels added. **Still to do:** dialog, toast, empty-state components; retiring the remaining overrides (shared public components, card/field rules); Home Screen app check on a real phone. Pages migrated one by one without behaviour change | All 34 admin pages render in the new shell; keyboard-only navigation works; Home Screen app works on phone; no functional regressions in the existing tests | M0 | Large visual diff; mitigated by shell first, pages after |
| **M2** | Authorization foundation | **Audit log only, built (this PR, schema `schema_audit.sql` awaits the owner's yes):** append-only `admin_audit_log` (database triggers refuse UPDATE and DELETE), `recordAudit` helper that never blocks the action, entries for sign-in, failed sign-in and sign-out, lead export/import/merge/undo, unsubscribe and erasure, campaign test/send/schedule/cancel, booking status and custom-trip confirm/refund, tour and offer create/update/delete (tour price changes show old and new), hotels and custom-trip settings, WhatsApp chat/message deletion and purge, automatic-reply switch; read-only viewer at `/admin/audit`. Actor is `owner` until M3. **Not started:** | Staff tables, gate in middleware, route-permission table, `authorize()`, audit log and helper, legacy cookie as Owner; **no team screens yet** | Route-inventory test proves no unauthenticated admin route; role tests pass; exports/sends/merges write audit rows; nothing changes for the current login | M0, M0b, schema yes | Mistaken deny blocking the owner; mitigated by legacy cookie and break-glass |
| **M3** | Team administration | **Built, two roles (this PR; schema `schema_staff.sql` awaits the owner's yes; setup in `docs/platform/IWIS_TEAM_ACCESS.md`):** staff accounts invited by email, Google sign-in at `/admin/auth/google/*`, server-side sessions that stop on suspend, single middleware gate plus per-route checks (route-inventory test), owner-only pages and actions, team page, audit actor is the person's email; owner password kept as emergency access. Roles are Owner and Team (everything except team, audit log, erasure and system settings), chosen by the owner for three support staff; the five-role catalogue is not built. | Invite by email, Google sign-in for staff, member list, role assignment, suspend and revoke, effective-permission view, audit viewer | Invite, sign in, restricted view, revoke, refused on next request, all demonstrated end to end | M2 | Google redirect set-up; at-least-one-owner invariant |
| **M4** | Workflow modernisation | Leads, WhatsApp inbox, bookings first: split data from markup, consistent tables and filters, saved views, better empty and error states | Same behaviour; each page has loading, empty and error states; measured speed not worse | M1 | Regressions in the busiest pages; mitigated by one page per PR |
| **M5** | Dashboards | "Today" board, my follow-ups, owner overview, all from existing tables | Every figure traceable to a query; respects permissions | M2, M4 | Misleading figures at tiny volumes; show counts, not trends, until data exists |
| **M6** | Release readiness | Rollback and recovery runbook, QA checklist, performance pass, accessibility review | Checklists signed off; recovery rehearsed | all | none significant |

Documents `IWIS_ACCESS_CONTROL_MATRIX`, `IWIS_DATABASE_MIGRATION_PLAN`, `IWIS_DESIGN_SYSTEM`, `IWIS_QA_CHECKLIST`, `IWIS_IMPLEMENTATION_ROADMAP` and `IWIS_CHANGELOG` from the brief will be created as their milestones land, so each reflects code that exists rather than plans.

---

## 7. Deliberately not proposed now

- Departments, department-scoped reporting and manager approval queues (no team yet).
- Record-level scopes beyond "all" (add `owner_id` filtering when there is more than one person working leads).
- A custom role editor (the five fixed roles cover the known jobs; editing role permissions can come with M3 if needed).
- New CRM objects (opportunities, accounts, documents). The brief says not to add them without a verified requirement, and none exists.
- AI features beyond those already in the WhatsApp assistant.
- Microservices or new infrastructure. The current Cloudflare stack is enough.

---

## 8. Questions only you can answer

1. **Who will use admin besides you in the next 3 to 6 months, and doing what?** (For example WhatsApp replies, bookings and drivers, content.) This decides the default roles in section 4.4.
2. **Is there anything staff must not see?** For example payment amounts, customer phone numbers, WhatsApp conversations, exports.
3. **How should staff sign in?** My recommendation is Google accounts (Option C). Do the people you have in mind have Google accounts?
4. **Do you use admin from the phone Home Screen app daily?** If yes, the phone layout is a first-class requirement of the new shell.
5. **Palette:** keep the current violet brand (recommended) or move to `#6D4AFF`?

## 9. What I need approved to start

- **Start M0** (CI checks, backup rehearsal, route sweep). It changes no behaviour of the live site or admin.
- Your answers above, so M1 and M2 can be specified exactly.
- Later, an explicit yes before any schema is applied to production (M2) and before the new gate is deployed.
