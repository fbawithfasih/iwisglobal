# Email campaigns runbook

How to set up and run marketing campaigns from `/admin/campaigns`. Nothing real is sent until every step under "Before the first real send" is done.

## How it works

- Audience = people whose `marketing_status` is `subscribed` (double opt-in confirmed) and who are not suppressed. Filters only narrow this; they can never widen it.
- Write the English version. "Translate" drafts German, French and Spanish with Claude. Each translation is saved unapproved; people who read that language get English until you tick "I have read and approve this".
- A real send needs: English content, a test send, `MARKETING_SENDING_ENABLED=1`, `MARKETING_EMAIL_FROM`, `UNSUBSCRIBE_SECRET`, `RESEND_API_KEY`.
- Sending is in batches of 100 through Resend's batch API. Each chunk has an idempotency key, so a retry never double-sends. A GitHub Action calls `/api/campaigns/tick` every 5 minutes to continue sending and to start scheduled campaigns.
- Every email carries its own signed unsubscribe link, the `List-Unsubscribe` and `List-Unsubscribe-Post` headers (one-click), the privacy link and the postal address. Suppression and status are re-checked per recipient at send time.
- Daily cap: `MARKETING_DAILY_CAP` (default 200) limits how many go out per day (UTC) while the sender reputation warms up. A campaign larger than the cap simply continues the next day.

## One-time setup

1. **Schema** (owner only, before deploying the code): `wrangler d1 execute iwisglobal-bookings --remote --file=schema_campaigns.sql`
2. **Sending subdomain** `news.iwisglobal.com`
   - In Resend: Domains, Add Domain, `news.iwisglobal.com`. Pick the region closest to your readers.
   - In Cloudflare DNS add the records Resend shows (SPF TXT, DKIM CNAMEs/TXT, and the MX for the bounce path). Every one must be **DNS only** (grey cloud), never proxied.
   - Add a DMARC record for the subdomain: TXT `_dmarc.news` = `v=DMARC1; p=none; rua=mailto:info@iwisglobal.com`. Move to `quarantine` once reports look clean.
   - Click Verify in Resend and wait for all records to show Verified.
3. **Sign the Resend data processing agreement** and have a lawyer (ideally German) review the consent wording and the privacy policy. All non-English text is machine-translated.
4. **Cloudflare Pages variables** (Production):
   - `MARKETING_EMAIL_FROM` = `IWIS Global <news@news.iwisglobal.com>`
   - `CAMPAIGN_CRON_SECRET` = a long random string
   - `MARKETING_DAILY_CAP` = optional, default 200
   - `UNSUBSCRIBE_SECRET` should already exist from the newsletter signup.
   - Leave `MARKETING_SENDING_ENABLED` unset for now.
5. **GitHub secret** `CAMPAIGN_CRON_SECRET` with the same value (the workflow skips quietly until it exists).
6. Redeploy so the variables take effect.

## Seed-inbox test

1. Subscribe a few real test addresses through the footer form and confirm them: a Gmail, an Outlook/Hotmail and a German provider (GMX or web.de).
2. Create a campaign, fill in English, and use **Send test** to those addresses. Test emails are marked `[TEST]` and are not counted.
3. In Gmail open the message, "Show original", and check: SPF PASS, DKIM PASS, DMARC PASS, and that `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` are present. Gmail should show its own "Unsubscribe" link next to the sender.
4. Check it does not land in spam on all three providers, and the layout looks right on a phone.

## Before the first real send

- [ ] Seed-inbox test passed (above)
- [ ] Preview each language you will send; approve only translations you have read
- [ ] Audience count and language split look right
- [ ] Privacy policy and consent wording reviewed
- [ ] Set `MARKETING_SENDING_ENABLED=1` in Cloudflare Pages and redeploy
- [ ] First campaign goes only to your own subscribed addresses (use a tag or country filter)

## Warm-up schedule

New sending domains should ramp slowly. Raise `MARKETING_DAILY_CAP` only when complaints stay under 0.1% and bounces stay low:

| Days | Daily cap |
|------|-----------|
| 1-3  | 200       |
| 4-7  | 500       |
| 8-14 | 1,000     |
| 15+  | raise by about 50% every few days |

## Stopping

- **Cancel** in the campaign page stops everyone not yet sent.
- Unset `MARKETING_SENDING_ENABLED` (or set it to 0) and redeploy to pause every campaign immediately.

## Bounces, complaints and clicks (Release 3-C)

1. **Schema** (owner only, before deploying): `wrangler d1 execute iwisglobal-bookings --remote --file=schema_events.sql`
2. **Webhook**: in Resend, Webhooks, Add Endpoint: URL `https://www.iwisglobal.com/api/webhooks/resend`, events `email.delivered`, `email.bounced`, `email.complained`, `email.delivery_delayed`. Copy the signing secret (starts with `whsec_`) into Cloudflare Pages as `RESEND_WEBHOOK_SECRET` and redeploy. Without it the endpoint answers 503 and nothing is trusted.
3. A **permanent bounce** or a **spam complaint** suppresses that address for good and sets the person to "bounced" or "complained", so they drop out of every audience. Temporary bounces (full mailbox) are recorded but do not suppress. Each webhook delivery is stored once, so Resend retries are harmless.
4. **Clicks**: links in campaign emails go through `https://www.iwisglobal.com/r/<code>`, which redirects only to the stored link and adds one to that link's daily count. No person, address or IP is stored. Mail programs sometimes open links to scan them, so treat counts as an upper estimate. Opens are not tracked.
5. **Report**: `/admin/leads/report` shows leads, quotes, deposits, bookings, revenue and first-reply time by channel and by campaign, per-campaign delivery counts, and where you enter marketing spend (cost per lead and per booking use only what you enter).
6. Test: send a campaign to your own Gmail and a Resend test address `bounced@resend.dev` / `complained@resend.dev` (Resend simulates those events), then check the person's status in `/admin/leads/subscribers`.
