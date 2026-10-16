# Plan: WhatsApp reply agent

**Source PRD**: `.claude/prds/whatsapp-reply-agent.prd.md`
**Selected Milestone**: 1, Webhook and send (milestone 0 is the owner's Meta setup and must finish first). Milestones 2 to 7 are outlined at the end and get their own plans.
**Complexity**: Large overall, Medium for milestone 1

## Summary

Add a WhatsApp Business Platform webhook to the Astro site that verifies Meta's signature, stores every conversation and message in D1, de-duplicates by Meta's message ID, and can send a reply through the Cloud API. No AI yet: this milestone proves the pipe. It follows the existing Razorpay webhook for signature checking and the AI guide for how Claude is called, so later milestones add the brain without reshaping the plumbing.

## Patterns to Mirror

| Category | Source | Pattern |
|---|---|---|
| Webhook signature | `src/pages/api/webhooks/razorpay.ts:23-54` | Read the raw body first, HMAC-SHA256 with Web Crypto, constant-time compare, reject before parsing JSON |
| Env access | `src/lib/env.ts` (`resolveEnv`) | Read secrets from the Cloudflare runtime and fall back to `import.meta.env`; add each new secret to this one map |
| Claude call | `src/lib/aiGuide.ts` (`askYourGuide`, `buildSystemPrompt`) | Plain `fetch` to the Anthropic API, prompt rebuilt from live catalogue data, a fixed fallback text on any failure |
| Rate limit | `src/lib/aiGuide.ts` (`checkRateLimit`, `recordRequest`) | Count rows in D1 per hashed identity per day, record before the paid call |
| Background work | `src/pages/forgot-password.astro:34` | `runtime.ctx.waitUntil(promise)` with an inline fallback |
| D1 access | `src/lib/db.ts` (`D1Like`) | All queries through the narrow `D1Like` type, parameter binding only |
| Migrations | `schema_*.sql` in repo root (for example `schema_booking_locale.sql`) | One additive SQL file per change, applied to production D1 before the deploy that uses it |
| Primary DB reads | `src/middleware.ts:11` (`PRIMARY_PATHS`) | `/api/*` already reads from the primary, so a write is never followed by a stale read |
| Admin pages | `src/pages/admin/*` and `src/lib/requireAdmin.ts` | Admin routes are protected by the existing admin session |
| Tests | none in this repo (`CLAUDE.md`: `astro check` is the only static check) | See Validation: scripted checks with `esbuild` and `node`, as used for the availability and email work |

## Files to Change (milestone 1)

| File | Action | Why |
|---|---|---|
| `schema_whatsapp.sql` | CREATE | `wa_conversations`, `wa_messages` (unique Meta message ID), `wa_settings` (auto-reply switch, default off) |
| `src/lib/whatsapp.ts` | CREATE | Signature check, parse Meta's webhook payload, normalise phone numbers, `sendText`, store and de-duplicate messages |
| `src/pages/api/webhooks/whatsapp.ts` | CREATE | `GET` for Meta's verification handshake, `POST` for incoming events |
| `src/lib/env.ts` | UPDATE | Add `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` |
| `.env.example` | UPDATE | Document the four new variables (names only) |
| `src/pages/admin/whatsapp/index.astro` | CREATE | Read-only list of conversations and messages, to see the pipe working |
| `src/pages/admin/index.astro` | UPDATE | Link to the new page |

## Tasks

### Task 1: Meta setup (owner, milestone 0)
- **Action**: In Meta Business Suite, confirm the number can use coexistence. Create or open the Meta developer app, add the WhatsApp product, link the business account, create a system user and a permanent token, note the phone number ID and app secret, choose a long random verify token. Put the four values in Cloudflare Pages secrets. Never paste them in chat.
- **Mirror**: How `RAZORPAY_WEBHOOK_SECRET` is held today
- **Validate**: Meta's "Verify and save" for the webhook URL succeeds once Task 4 is deployed

### Task 2: Schema
- **Action**: Write `schema_whatsapp.sql` with the three tables. Store a hash of the sender and the normalised phone, state (`agent`, `staff`, `handed_off`, `opted_out`), language, timestamps. `wa_messages` has direction, text, Meta message ID (unique), status, tool and knowledge-base IDs (empty for now), model and cost (empty for now). Apply to production D1 before deploying.
- **Mirror**: `schema_ai_guide_usage.sql` for comments and index style, `schema_booking_locale.sql` for additive changes
- **Validate**: `SELECT name FROM sqlite_master` shows the tables; inserting the same Meta message ID twice is rejected

### Task 3: Library
- **Action**: In `src/lib/whatsapp.ts`: `verifySignature(rawBody, header, appSecret)`, `parseWebhook(json)` returning incoming messages, status updates and app-sent echoes, `normalisePhone`, `storeIncoming` (idempotent), `sendText(env, to, body)` calling Graph API `/{phone-number-id}/messages`. Treat the Graph API version as one constant. Catch and log errors; never throw into the webhook.
- **Mirror**: HMAC helpers in `razorpay.ts:23-40`, the fetch and fallback shape in `aiGuide.ts:93-`
- **Validate**: Script with `esbuild` + `node`: a forged signature is rejected, a replayed message ID is stored once, a sample Meta payload parses into the expected messages

### Task 4: Webhook route
- **Action**: `GET` answers Meta's handshake only when the verify token matches. `POST` reads the raw body, rejects a bad signature with 401 before parsing, stores messages, and returns 200 quickly. Processing beyond storage is handed to `waitUntil` (nothing yet in this milestone).
- **Mirror**: `src/pages/api/webhooks/razorpay.ts` response and logging style
- **Validate**: `curl` with a correctly signed sample returns 200 and creates rows; an unsigned or wrongly signed request returns 401 and creates none; the handshake returns the challenge only with the right token

### Task 5: Admin view
- **Action**: Read-only page listing conversations (newest first) and their messages, plus the auto-reply switch showing Off.
- **Mirror**: `src/pages/admin/reviews/index.astro` layout and `requireAdmin`
- **Validate**: Page shows the test conversation after the Task 4 check; not reachable when signed out

### Task 6: Live check
- **Action**: From a test phone, message the number, confirm the message appears in the admin page, then send one reply with `sendText` from a one-off script or temporary admin button.
- **Validate**: Reply arrives on the phone; nothing is auto-sent; staff replies sent from the Business app still work and appear as echoes

## Validation

```bash
export PATH=/Users/fasihuddinahmer/.nvm/versions/node/v22.22.1/bin:$PATH
npx astro check     # 0 errors
npm run build       # passes
# signature, replay and payload checks (scripted, as in earlier work)
npx esbuild /tmp/wa-test.ts --bundle --platform=node --format=esm --outfile=/tmp/wa-test.mjs && node /tmp/wa-test.mjs
```

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Number not eligible for coexistence | Medium | Settled in Task 1 before any code ships; fall back to API-only or a second number |
| Meta retries a slow webhook and duplicates messages | High | Respond fast; unique Meta message ID; idempotent store |
| Forged requests reach the webhook | Medium | Signature check before parsing; tested with a forged request |
| Personal data stored without need | Medium | Keep only what the agent needs; retention job in a later milestone |
| Meta changes field names or rules | Medium | Constants in one place; recheck Meta's docs at build time |
| Staff replies from the app and the agent collide | Medium | Echo handling in milestone 4; auto-reply stays off until then |

## Later milestones (separate plans)

- **2 Knowledge base and drafts**: `wa_kb_entries`, retrieval, intent routing, a draft reply for every incoming message shown in the admin for approval, and the evaluation set.
- **3 Tools**: read-only tour, availability, booking-link and own-booking-status tools reusing `tours.ts`, `availability.ts`, `crm.ts`.
- **4 Hand-off and inbox**: handling rules, staff alerts through Resend, take-over and give-back, app-echo detection.
- **5 Auto-reply**: per-intent switches behind a kill switch.
- **6 Learning loop**: scheduled job proposing entries from site changes, staff replies and gaps; approval queue.
- **7 Launch gates**: accuracy and hand-off targets, weekly audit.

## Acceptance

- [ ] Owner has confirmed coexistence and supplied the four values as secrets
- [ ] Webhook handshake succeeds in Meta
- [ ] Forged and unsigned requests are rejected; replays are stored once
- [ ] Incoming test messages appear in the admin page
- [ ] A test reply is delivered; nothing is sent automatically
- [ ] `astro check` and `npm run build` pass
