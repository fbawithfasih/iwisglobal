# Email marketing: consent, confirmation and unsubscribe (Release 3-A)

Nobody is mailed unless they signed up **and** clicked the link in a confirmation email (double opt-in).

## How people opt in
- **Footer signup** on every public page (needs a ticked, never pre-ticked box), the **contact form** box, and a **Meta lead form question** that is an explicit consent question answered yes. A standard lead form (name, email, phone) is not consent.
- Each of these records the exact wording shown (versioned by a hash of the text, so edited wording can never reuse an old version), the date, and the page; then sends **one neutral confirmation email**. The person stays "pending" until they press the button on `/confirm-subscription` (a mail scanner opening the link cannot confirm: only the button press, a POST, does).

## Unsubscribe
- Every marketing email (Release 3-B) will carry `/unsubscribe/<signed link>` plus the one-click `List-Unsubscribe` header. Opening the link only shows a button; pressing it (or Gmail/Yahoo/Apple one-click) suppresses every address of that person immediately.
- A person who unsubscribed can sign up again deliberately: a fresh, confirmed opt-in lifts an *unsubscribe* suppression. Complaints, hard bounces and erasures are never lifted by a signup.
- On a lead page, "Email consent and data" lets you resend the confirmation, mark someone unsubscribed on their request, or **erase** them (type ERASE): names, contact details, history and consent records are deleted; only a scrambled hash of their addresses stays so they are never mailed again.

## Going live (once)
1. Apply `schema_marketing.sql` to the live database **before** deploying.
2. Add `UNSUBSCRIBE_SECRET` in Cloudflare Pages (Production): a long random string. Without it unsubscribe links are rejected.
3. Deploy (merge, then GitHub Action). 
4. Test with a personal address: sign up in the footer, find the confirmation email, press the button, check `/admin/leads/subscribers` shows you under "Subscribed" (a footer signup does not create a lead), then re-test with an unsubscribe link (made in Release 3-B).

## Still gated
No campaign can be sent yet (Release 3-B). Before the first real send: the lawyer reviews the consent wording and the privacy policy (all four languages are machine-translated and unreviewed), the Resend data-processing agreement is signed, and the sending subdomain is set up.
