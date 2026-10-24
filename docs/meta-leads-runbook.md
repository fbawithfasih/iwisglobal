# Facebook / Instagram leads: setup runbook

What it does: Facebook/Instagram **lead-ad form** submissions, **Instagram DMs** and **Facebook Page Messenger** messages become leads in `/admin/leads`
(`src/pages/api/webhooks/meta.ts`, `src/lib/meta.ts`). Nothing is ever sent back automatically.
Status and manual retry: `/admin/leads/meta`.

Never paste tokens or secrets in chat, commits or issues. Set them in Cloudflare Pages (Settings, Variables and secrets, Production) and, for the poll secret, also in GitHub (Settings, Secrets and variables, Actions).

## 1. Database (once, before deploy)
Apply `schema_meta.sql` (adds `meta_events`). Until it is applied the webhook answers 500 and Meta retries for ~36 hours, so apply it first.

## 2. Meta app (developers.facebook.com)
- Use the app that is already Business Verified, switch it to **Live**.
- Add the use cases **Capture & manage ad leads** and the messaging use cases for **Instagram** and **Messenger**.
- Permissions: `leads_retrieval`, `pages_show_list`, `pages_manage_metadata`, `pages_read_engagement`, `pages_messaging`, `instagram_basic`, `instagram_manage_messages`.
  Check in the App Dashboard whether **Advanced Access / App Review** is needed for these on an app that only serves your own Page and Instagram account; allow a few days if it is.
- The Instagram account must be a professional account linked to the Facebook Page, with "Allow access to messages" on in Instagram settings (Messages and story replies, Message controls, Connected tools).

## 3. Business Settings (business.facebook.com)
- Integrations, Leads Access (CRM integrations): give the app access to the Page's leads. Without this real leads silently never arrive.
- Create a **system user**, assign the Page (and app), generate a token with the permissions above. This token does not expire after an hour.

## 4. Webhook
In the app: Webhooks.
- Callback URL `https://www.iwisglobal.com/api/webhooks/meta`, verify token = your `META_VERIFY_TOKEN`.
- Object **Page**: subscribe to `leadgen` and `messages`. Object **Instagram**: subscribe to `messages`.
- Subscribe the Page to the app: `POST /{page-id}/subscribed_apps?subscribed_fields=leadgen,messages` with the Page token (or tick it in the Page's Webhooks settings).

## 5. Variables (Cloudflare Pages) and GitHub secret
| Name | What |
|---|---|
| `META_APP_SECRET` | App secret of this Meta app (signs every webhook) |
| `META_VERIFY_TOKEN` | Any random string; the same as typed in the webhook form |
| `META_PAGE_ACCESS_TOKEN` | System-user (Page) token |
| `META_PAGE_ID` | Facebook Page id |
| `META_POLL_SECRET` | Random string; ALSO a GitHub Actions secret of the same name |

`/admin/leads/meta` shows which are set (never the values).

## 6. Test
1. Meta's **Lead Ads Testing Tool** (developers.facebook.com/tools/lead-ads-testing): create a test lead for the Page and form; it should appear in `/admin/leads` within seconds, channel "Facebook/Instagram ad", with the campaign and form id in its history.
2. From a personal Instagram/Facebook account that has a role on the app (while the app is not yet approved), send a DM to the account/Page: it appears as "Instagram DM" / "Facebook DM". An email address typed in the message is attached to the person.
3. Actions, "Meta lead poll", Run workflow: the run must succeed. `/admin/leads/meta` shows counts.
4. Replaying the same webhook never creates a second lead (events are unique by lead id / message id).

## Behaviour to know
- A standard lead form (name, email, phone) is **not** marketing consent. Only an explicit custom consent question answered yes records consent (still "pending" until double opt-in, Release 3).
- Meta deletes leads after 90 days; every lead is stored on arrival and the 15-minute poll fetches any the webhook missed (look-back 3 days).
- DM-only contacts are kept as their own person until they give an email or phone; a `+` country-code number or email typed in the chat links them to existing records.
- Instagram/Messenger replies are limited to 24 hours after the person's last message; replying is done in the Meta Business Suite inbox, not here.

## Asking for email consent on the instant form

A standard form (name, email, phone) is **not** marketing consent. To collect it, add one extra question to the form. Do this in Meta Business Suite or Ads Manager, not in our code.

1. Open **Meta Business Suite**, then **All tools**, then **Instant forms** (or Ads Manager, then the form library). Open the form you use for your ads and choose **Duplicate**. Published forms usually cannot be edited, so you edit the copy and point your ads at it.
2. In the copy, go to **Questions**, then **Add custom question**, and choose **Multiple choice** (Yes/No).
3. Question text: **Would you like occasional travel ideas by email?** Options: **Yes, email me travel ideas** and **No thanks**. Do not pre-select Yes, and do not make the question required.
4. Leave the name, email and phone questions as they are. Keep the privacy policy link to `https://www.iwisglobal.com/privacy`.
5. Save the copy, then change your ad to use it. Take a screenshot of the form's questions and keep it with today's date: it is the proof of what people agreed to.
6. Submit a test lead (Meta's Lead Ads Testing Tool or the live ad), answer **Yes**, and check:
   - the lead shows in `/admin/leads` with the channel Facebook/Instagram ad;
   - the person shows under **Waiting for confirmation** in `/admin/leads/subscribers`, and a confirmation email arrives;
   - after pressing the button in that email they show as **Subscribed**.
7. A person who answers **No thanks**, or leaves it blank, gets no confirmation email and is never emailed marketing.

How it is read: our code accepts the answer when the question's name contains words like consent, marketing, newsletter, updates, offers or "travel ideas" (Meta builds the name from the question text) and the answer starts with Yes. It also reads the optional checkboxes of the privacy step of the form (a separate field in Meta's data) when their name says the same. A checkbox that only accepts the privacy policy never counts as marketing consent. If you word the question very differently, tell us the wording so the match can be extended.
