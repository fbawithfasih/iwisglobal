# Team access (M3): setting it up

Written 26 Oct 2026. Three more people use the admin to follow up enquiries and answer messages. Until now they shared the owner password; this gives each person their own Google sign-in, their own audit trail, and an off switch.

## Who can do what

| | Owner (you) | Team member |
|---|---|---|
| Leads, WhatsApp, bookings, tours, offers, campaigns, hotels bookings, blog, reviews, reports, exports | yes | yes |
| Team page (invite, suspend, remove) | yes | no |
| Audit log | yes | no |
| Erase a person (right to be forgotten) | yes | no |
| System settings: "Customise your tour" prices and switch, hotel markup and on/off switch, Meta connection, contact rebuild, automatic WhatsApp replies and launch checks, deleting old WhatsApp conversations in bulk | yes | no |

Team members can still delete a single WhatsApp message or chat, send campaigns, edit prices and export leads, because "everything except settings" was chosen. Say so if you want any of those moved to owner-only (it is a one-line change in `src/lib/authz.ts`).

The owner password stays as emergency access. Every use is written to the audit log as `owner`.

## What you do, in order

1. **Merge the PR, after step 2.** The code works without the tables but nobody can be invited until they exist.
2. **Say "apply the staff schema"** (`schema_staff.sql`: two new tables). I apply it; nothing existing changes.
3. **Add the redirect address in Google.** In Google Cloud Console, open the same OAuth client the website's "Continue with Google" uses (Credentials), and under "Authorised redirect URIs" add exactly:
   `https://www.iwisglobal.com/admin/auth/google/callback`
   Keep the existing `/auth/google/callback` one. No new secrets are needed.
4. **Invite each person** on the admin Team page with the email address of their Google account (Gmail or Google Workspace). They open `https://www.iwisglobal.com/admin/login`, choose "Continue with Google" and pick that account. The first sign-in activates the invite (valid 14 days).
5. **Stop sharing the owner password.** Once all three can sign in with Google, set a new owner password that only you know:
   1. On your own computer, in a copy of this repository, run `node scripts/admin-password.mjs`. Type the new password (hidden, 12 characters or more) twice. It prints `ADMIN_PASSWORD_SALT=...` and `ADMIN_PASSWORD_HASH=...`; the password itself is never printed or stored.
   2. In Cloudflare Pages (the iwisglobal project, Settings, Variables and Secrets, Production), replace the two secrets `ADMIN_PASSWORD_SALT` and `ADMIN_PASSWORD_HASH` with those values, and redeploy.
   3. Test it in a private window. Sessions already signed in with the old password stay valid for up to 12 hours, then end on their own.
   Keep the new password in your password manager. Never paste it or the secrets into a chat.

## Day to day

- **Suspend** stops someone on their very next click (their sessions are revoked immediately). **Reactivate** brings them back. **Sign out everywhere** ends their sessions without suspending. **Remove** deletes the account (type REMOVE); their past audit entries remain.
- Sessions last 7 days. A person who leaves should be suspended, not just left to expire.
- Someone whose Google account email changes needs a fresh invite for the new address.
- A team member cannot invite anyone or see this page. If a team member opens an owner-only address they see "This page is only for the owner."

## How it is protected

- Every `/admin` request is identified in one place (`src/lib/adminGate.ts`) before any page runs, and every page and action also checks for itself. A test (`scripts/contacts-test/route-inventory.ts`) fails the build if a new admin page forgets its check.
- Owner-only pages are matched after decoding the address, so `/admin/%74eam`, `//admin//team`, `/ADMIN/TEAM` and `/admin/x/../audit` are refused too.
- The cookie holds a random token; the database stores only its SHA-256, so a database leak cannot be replayed as a sign-in.
- Only an invited address that Google confirms as verified can sign in, and once signed in the account is tied to that Google identity.
- Every sign-in, refused sign-in (with the email tried), sign-out and team change is in the audit log.

## Known limits

- No email is sent for an invite: tell the person yourself.
- There is no per-person restriction beyond the two roles (for example "this person sees only their own leads"). If that is needed later it is a separate piece of work.
- Astro's built-in cross-site form check is still on (see the open one-click-unsubscribe note in `docs/campaigns-runbook.md`).
