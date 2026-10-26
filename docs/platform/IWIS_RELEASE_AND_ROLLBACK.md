# IWIS Global: releasing, rolling back and recovering

Status: 27 Oct 2026 (milestone M6). Written to be used under stress: each section says what to do, in order. Nothing in this runbook has been rehearsed against the live site yet: the steps need a Cloudflare login that the build environment does not have. Each is marked **[Not rehearsed]** and listed under "What needs you". The database recovery tools were rehearsed locally (see `IWIS_BACKUP_AND_RECOVERY.md`).

## How a change reaches the live site

1. A change is made on a branch and opened as a **draft pull request**. GitHub runs the `checks` job (type check, build, all tests) and GitGuardian (secret scan).
2. It is merged only when you say so. Merging to `main` makes the GitHub Action "Deploy to Cloudflare Pages" publish it (about 2 to 3 minutes).
3. If the change needs new database structure, that structure is applied to production **before** the merge, only after you say yes (see `IWIS_DATABASE_MIGRATION_PLAN.md`).
4. Secrets (API keys, tokens, passwords) live in Cloudflare Pages settings, never in the repository or in chat.

## Rolling back a bad release

Pick the quickest that fits. Neither touches your data.

**A. Put the previous version back (fastest) [Not rehearsed].** In the Cloudflare dashboard open Workers & Pages, the `iwisglobal` project, Deployments, choose the last good deployment and roll back to it. The live site serves the old build in moments. Do this first when something important is broken.

**B. Revert the change in GitHub [Not rehearsed].** Ask me to revert the pull request, or revert it yourself on GitHub ("Revert" on the merged pull request). That creates a normal pull request; merging it deploys the old behaviour as a new release. Slower than A but leaves a clean history, so do it after A.

**Why rolling back code is safe:** database changes are additive only (new tables, new columns with defaults). The previous code simply ignores a column or table it does not know. So you never need to undo a database change to roll back code. Leave the new structure in place.

## When data is wrong

Rolling back code does not fix data written wrongly. Use D1 Time Travel, described step by step in `IWIS_BACKUP_AND_RECOVERY.md`. Note what the rewind loses: anything written after the chosen moment (bookings, payments, leads, messages). Razorpay and WhatsApp keep their own records, so reconcile by hand.

## Switches that stop things without a deploy

| Problem | Switch | Where |
|---|---|---|
| Email campaign must not send | Remove `MARKETING_SENDING_ENABLED` (or set it to anything but `1`) | Cloudflare Pages settings, then redeploy |
| WhatsApp automatic replies misbehaving | Turn automatic replies off | `/admin/whatsapp/auto` (owner) |
| Hotel booking misbehaving | Switch hotels off | `/admin/hotels` (owner) |
| "Customise your tour" misbehaving | Switch it off | `/admin/custom-trips` (owner) |
| A team member's account is compromised or they have left | Suspend or remove them | `/admin/team` (owner); effective on their next click |
| You think the owner password is known | Change it with `scripts/admin-password.mjs`, set the two values in Cloudflare Pages settings, redeploy | see `IWIS_TEAM_ACCESS.md` |
| The whole site or admin is broken after a release | The site and admin ship together; use rollback A | Cloudflare dashboard |

## After every release: a two-minute check

Do these in order. If any fails, roll back (A) and tell me.

1. Open the public home page and one tour page.
2. Sign in to `/admin` (you land on Today, which loads without a warning banner).
3. Open Bookings, Leads and WhatsApp. Each opens without an error.
4. Open one booking and one lead.
5. Check the `Server-Timing` number on Bookings (page request, Network tab). Over about 500 ms is worth telling me.

The full pre-release list is `IWIS_QA_CHECKLIST.md`.

## If something is on fire

1. Roll back (A). Do not debug on the live site first.
2. Note the time and what you saw (a screenshot helps).
3. Look at the audit log (`/admin/audit`) for what changed and who did it.
4. Tell me; I will find the cause on a branch, fix it, and bring it back as a normal pull request.

## What needs you

1. **Rehearse rollback A once**, when nothing is wrong: roll back one deployment in Cloudflare, check the site, roll forward to the latest. Tell me what you saw so the **[Not rehearsed]** mark can come off.
2. **Rehearse recovery once** (export and restore into a throwaway database), as listed at the end of `IWIS_BACKUP_AND_RECOVERY.md`.
3. Confirm the Cloudflare plan (Workers Paid or Free), which decides how far back Time Travel reaches (30 or 7 days).
