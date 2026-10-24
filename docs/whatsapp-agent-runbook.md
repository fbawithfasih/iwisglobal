# WhatsApp reply agent: runbook

For the person who runs IWIS Global's WhatsApp number (+91 6399226633). Plain language, no code needed.

## What it does

When a guest writes to the business number, the agent reads the message and writes a **draft reply** from three things only: the knowledge entries you approved, the live tour list, and a few safe lookups (is a date free, what would a group pay, the status of the guest's own booking). You read the draft and press Send. Later, once you trust it, it can send routine replies by itself. Refunds, complaints, booking changes, groups and medical messages always go to a person.

## The pages

All under the admin sign-in.

| Page | Address | Use it to |
|---|---|---|
| Chats | `/admin/whatsapp` | Read chats, edit and send drafts, take over or give back a chat |
| Knowledge base | `/admin/whatsapp/knowledge` | Approve what the agent may say; Find suggestions; import a chat export |
| Automatic replies | `/admin/whatsapp/auto` | The master switch, which kinds of message, limits, the weekly audit |
| Launch readiness | `/admin/whatsapp/launch` | The seven launch gates, self-checks, pilot results, the weekly report |

## One-time setup

1. In Meta (developer.facebook.com) create or open the app with the WhatsApp product, linked to the verified business. Confirm in Meta Business Suite that +91 6399226633 can use **coexistence** (the Business app and the Cloud API side by side).
2. In Cloudflare Pages, project `iwisglobal`, Settings, Variables and Secrets, add four secrets. Type them there yourself; never send them in a chat or email:
   - `WHATSAPP_VERIFY_TOKEN`: any long random text you invent
   - `WHATSAPP_APP_SECRET`: from the Meta app (App settings, Basic)
   - `WHATSAPP_ACCESS_TOKEN`: a permanent system-user token
   - `WHATSAPP_PHONE_NUMBER_ID`: from WhatsApp, API setup
3. In Meta, Webhook settings: callback URL `https://www.iwisglobal.com/api/webhooks/whatsapp`, verify token the same text as `WHATSAPP_VERIFY_TOKEN`. Subscribe to `messages` and `smb_message_echoes`.
4. Open Launch readiness and press **Run self-checks**. Everything should say OK.
5. Open the Knowledge base, press **Find suggestions**, read and approve entries. Optionally import a chat export (Import a chat export, near the bottom).

## Every day (5 minutes)

1. Open **Chats**. The page opens on **Needs a person** when there are any. Reply to those first. The amber text means a guest has waited over 30 minutes; red means less than 2 hours of WhatsApp's 24-hour free-reply window are left.
2. For a draft: read it, edit if needed, press **Send**. If it is wrong or unneeded, press **Discard**. Both count as "reviewed".
3. If you reply from the WhatsApp Business app instead, the chat moves to **Staff handling** by itself and the agent stops drafting for it. Press **Give back to agent** when you are done, or it returns on its own after 12 hours.
4. If the Business app on the phone is not available, answer from the admin: open the chat and use **Write your own reply** under the messages. It works inside the 24-hour reply window, moves the chat to **Staff handling**, and works for voice notes and images too (the guest message shows as [voice] or [image]; reply asking them to type).
4. **Email signup link:** under a draft or your own reply, the small **EN / DE / FR / ES** buttons under "Add email signup link" add one ready-made line to the message, in that language, inviting the guest to sign up for travel ideas by email at `iwisglobal.com/subscribe`. Nothing is sent until you press Send, and the agent never adds it by itself. Use it once, after you have helped the guest, not in every message. The guest still confirms by email and can unsubscribe any time, and the signup is recorded as coming from WhatsApp.
5. An email arrives when a chat first needs a person. It does not repeat more than once every 2 hours per chat.

## Every Monday (20 minutes)

1. **Automatic replies, Audit list.** Read the messages sent automatically since last week. Press **OK** or **Wrong**. Wrong switches that kind of message off at once and emails you. Each entry lists the knowledge it used, with a link to fix it.
2. **Knowledge base, Find suggestions.** Read the proposals (site changes show before and after, staff replies show the redacted evidence). Approve, edit or reject. Nothing is used until you approve it.
3. **Launch readiness, Email me this week's report.**
4. After any change to the site's policies, prices rules or the agent's prompts, run the evaluation again (see below).

## Switching automatic replies on

The master switch refuses until the gates pass. In order:

1. Review at least 50 real drafts (send or discard them).
2. Launch readiness shows all seven gates passing.
3. Pilot, four weeks: **week 1 greetings only**; add one more kind of message each week only if that week's audit had no Wrong marks. Suggested order: tour information, price, how to book, policy. Availability and booking status last.
4. At the end, write the four pilot results into the PRD results table.

## Switching off

- **Now:** Automatic replies, **Turn off now**. The very next message is handled as a draft. Nothing is lost.
- **One kind of message:** press Disable beside it.
- It also switches itself off if more than 30 automatic messages go out in one hour, and emails you.
- To stop the agent seeing messages at all: remove the webhook subscription in Meta. Drafts stop; the Business app keeps working.

## If a wrong message went out

1. Mark it **Wrong** in the audit list (this turns that kind of message off).
2. Open the chat and send the guest a correction from the Business app or from the page. Apologise plainly.
3. Open the knowledge entries it used (links under the message) and fix or retire them.
4. If a figure was wrong, check the tour prices and group prices in the tour editor.
5. Leave that kind of message off until you have re-checked a week of drafts, then run the evaluation and re-enable it.

## AI credit

The agent and the homepage YourGuide box use the same Anthropic account. If its credit runs out: drafts show "No draft: something went wrong", the homepage box shows its fallback text, and Launch readiness shows the AI gate failing. **Top up in the Anthropic console, Plans and Billing.** The self-check names the cause. Check the balance weekly; running the evaluation also uses credit.

## The evaluation

On the computer that holds the AI key, from the project folder:

```bash
export $(grep ANTHROPIC_API_KEY .env)
sh scripts/wa-eval/run.sh
```

It runs the test questions, the wrong-draft test of the fact check, and the redaction test. Copy the line that begins `RECORD` into Launch readiness, Evaluation, **Record result**. To add your own real questions first, press **Download real questions (redacted)** on that page and save the file as `scripts/wa-eval/real-questions.json`. A passing result on questions the agent was tuned against means "no known failures", not a guarantee; the real questions are what make it honest.

## Rotating a secret

Change it in Meta, then in Cloudflare (same names as above), then press **Run self-checks**. If you change the verify token, update it in Meta's webhook settings too.

## Privacy and guests' requests

- Message text is deleted after 12 months, automatically once a day when a message arrives (Knowledge base, Retention shows what is waiting). Knowledge entries are kept; their examples are redacted.
- A guest who writes exactly **STOP** gets no drafts or automatic replies until they write **START**.
- To delete one guest's chat on request, ask the developer to run, in the Cloudflare D1 console, for the guest's number with country code and no plus sign (here `919876543210`):

```sql
DELETE FROM wa_messages WHERE conversation_id = '919876543210';
DELETE FROM wa_drafts WHERE conversation_id = '919876543210';
DELETE FROM wa_conversations WHERE id = '919876543210';
```

## When something looks wrong

| You see | Likely cause | Do this |
|---|---|---|
| No new chats appear | Webhook not registered, or a secret is missing | Launch readiness, Run self-checks; check Meta webhook settings |
| Chats appear but "No draft: something went wrong" | AI credit used up, or the AI key is missing | Top up credit; Run self-checks |
| "No draft: daily limit reached" | The 300 drafts a day cap was hit | Normal on a very busy day; drafts resume tomorrow |
| Replying from the app does not mark the chat Staff handling | Coexistence off, or `smb_message_echoes` not subscribed | Press Take over by hand; fix the subscription in Meta |
| A kind of message will not enable | Fewer than 10 reviewed drafts of that kind, or under 90% sent unedited | Review more drafts of that kind; edit the knowledge behind it |
| The master switch will not turn on | Fewer than 50 reviewed drafts | Review more |
| Automatic replies switched themselves off | The 30-per-hour safety stop | Read the email; check the audit list before turning back on |

## Where things are (for the developer)

Webhook `src/pages/api/webhooks/whatsapp.ts`; drafts `src/lib/waDraft.ts`; lookups `waTools.ts`; knowledge `waKnowledge.ts`; learning `waLearning.ts`; chat states `waInbox.ts`; automatic replies `waAuto.ts`; launch checks `waLaunch.ts`; evaluation `scripts/wa-eval/`; database changes `schema_whatsapp*.sql` (apply to D1 before deploying the code that uses them). The plans are in `.claude/plans/` and the requirements in `.claude/prds/whatsapp-reply-agent.prd.md`.

## Phone alerts (Web Push)

A "needs a person" chat buzzes the owner's phone as well as sending the email. Setup, once:

1. Apply `schema_admin_push.sql` to production (`wrangler d1 execute iwisglobal-bookings --remote --file=schema_admin_push.sql`).
2. On your own computer run `node scripts/vapid-keys.mjs`. It prints `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`. Set both as Cloudflare Pages secrets (Production). Do not paste them into chat or the repository.
3. Redeploy (secrets only apply to a new deployment).
4. On the iPhone, open the Home Screen app, go to WhatsApp, press **Turn on alerts**, allow notifications, then **Send test alert**.

The alert shows the guest's name and the reason only, never the message text. Tapping it opens that chat. A phone that stops accepting alerts is removed automatically; press **Turn on alerts** again to re-add it. Changing the VAPID keys later means every device must turn alerts off and on again.

## Templates for chats outside the 24-hour window

WhatsApp only lets the business send an approved template to a guest who last wrote more than 24 hours ago. Chats in that state show a template form instead of the reply box (`/admin/whatsapp`).

- The wording lives in `src/lib/waTemplates.ts`: `iwis_followup` (follow up on an enquiry) and `iwis_booking_update` (an update about a booking), each in English (`en`) and German (`de`), with one parameter `{{1}}` for the guest's first name.
- Each template must exist in Meta (WhatsApp Manager, Message templates) under exactly that name, language and body, and be **approved**, before it can be sent. Until then WhatsApp refuses the send and the page says which template is missing.
- Meta decides the category (utility or marketing) and may reclassify; marketing templates cost more per message. Every template message is billed by WhatsApp.
- One template per guest per 24 hours; never to a guest who opted out. Sending one moves the chat to Staff handling. When the guest replies, the 24-hour window reopens and the normal reply box returns.
- To add a language or a new template, add it to `WA_TEMPLATES` and submit the same text in Meta.
