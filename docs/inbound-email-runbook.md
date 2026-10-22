# Email enquiries into Leads: setup runbook

Flow: someone emails info@iwisglobal.com (Google Workspace) -> a Google routing rule also sends a copy to
`enquiries@leads.iwisglobal.com` -> Cloudflare Email Routing hands it to the Worker `workers/inbound-email` ->
the Worker posts it to `/api/inbound/email` -> it appears in `/admin/leads` (channel Email, or Marketplace).
Your Gmail mailbox keeps receiving everything as before, so a failure anywhere here loses nothing.

Why a subdomain: Cloudflare Email Routing needs the MX records of the domain it receives for. `iwisglobal.com`'s MX stays with Google;
only `leads.iwisglobal.com` points at Cloudflare. No secrets in chat, commits or issues.

## 1. Cloudflare Email Routing on the subdomain
Cloudflare dashboard, iwisglobal.com, Email, Email Routing: add `leads.iwisglobal.com` as a subdomain and accept the MX/TXT records it proposes (they live on the subdomain only; do not touch the root MX).
Create the address `enquiries@leads.iwisglobal.com` with action "Send to a Worker" -> `iwis-inbound-email` (after step 2).

## 2. Deploy the Worker (once)
```
cd workers/inbound-email
npm install
npx wrangler deploy
npx wrangler secret put INBOUND_EMAIL_SECRET     # a long random string
```
Optional: in `wrangler.toml` set `FORWARD_TO` to a verified Email Routing destination address that should also get a copy.

## 3. The site
Cloudflare Pages variable `INBOUND_EMAIL_SECRET` (same value as the Worker secret). Until it exists the endpoint answers 404 to everyone.

## 4. Google Workspace routing rule
Admin console, Apps, Google Workspace, Gmail, Routing: add a setting for inbound mail to `info@iwisglobal.com`, "Also deliver to" `enquiries@leads.iwisglobal.com`. The original sender stays as From.

## 5. Test
Send a mail from a personal address to info@iwisglobal.com: it still arrives in Gmail AND a lead appears within a minute.
If the lead is missing, check Cloudflare, Email Routing, Activity log (a DMARC rejection of the forwarded copy shows there) and the Worker logs.

## What is ignored
Our own domain, no-reply/mailer-daemon/notification senders, auto-replies and out-of-office, anything with `Auto-Submitted`, `Precedence: bulk` or `List-Unsubscribe`. Ignored mail is still in Gmail.

## Marketplaces
GetYourGuide, Viator, Tripadvisor, Airbnb Experiences, Klook and Civitatis write from masked relay addresses. These become channel Marketplace with the relay address saved as a **shared** identifier (never matched to other records, never marketed to) and the booking reference in the note.
Each marketplace email is its own lead (the masked address cannot tell people apart), so merge or close duplicates by hand.

## Daily digest
`.github/workflows/leads-digest.yml` calls `/api/leads/digest` at 09:00 India time: unanswered leads, follow-ups due, quotes awaiting a reply, stale leads (email and Web Push; silent when there is nothing).
Needs `LEADS_CRON_SECRET` in Cloudflare Pages AND as a GitHub Actions secret (same value).
