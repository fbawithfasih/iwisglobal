# IWIS Global: who can do what in the admin

Status: 27 Oct 2026 (milestone M6). The rules live in `src/lib/authz.ts` and are enforced in `src/lib/adminGate.ts` before any page runs. The test `scripts/contacts-test/access-matrix.ts` fails if a rule in the code is missing from this page, so this page cannot quietly drift from the code.

## The two roles

| Role | Who | How they sign in |
|---|---|---|
| **Owner** | You | The owner password, or a Google account you have added as Owner (see `IWIS_TEAM_ACCESS.md`) |
| **Team** | The people you invite on the Team page | Google sign-in only, with the invited address |

Team means everything except settings. A Team member's access is checked on every click against their account status, so suspending someone takes effect on their very next click.

## Pages only the Owner can open

The menu hides them from Team and the gate refuses them if a Team member types the address.

| Page | Why it is owner-only |
|---|---|
| `team` | Staff accounts: inviting, suspending and removing people |
| `audit` | The audit log |
| `overview` | Owner overview: money totals and each person's workload |
| `custom-trips` | "Customise your tour" prices, vehicles, fees and the on/off switch |
| `leads/meta` | Meta (Facebook, Instagram) connection and conversion settings |
| `leads/backfill` | Bulk rebuild of the contact records |
| `whatsapp/launch` | Automatic-reply launch checks |
| `whatsapp/auto` | Automatic-reply on/off and limits |

## Actions only the Owner can take on pages Team can open

| Area | Action | What it does |
|---|---|---|
| `person` | `erase` | Erase a person's data (right to be forgotten) |
| `hotels` | `switch_on` | Turn hotel booking on |
| `hotels` | `switch_off` | Turn hotel booking off |
| `hotels` | `save` | Change markup and exchange rates |
| `hotels` | `refresh` | Refresh hotel content |
| `whatsapp` | `purge` | Delete old WhatsApp conversations |

## Everything else

Open to both Owner and Team: Today, Bookings (including notes, itinerary, tickets, status, review requests), Leads (list, detail, import, export, subscribers, report), the WhatsApp inbox and answers, Tours, Hotels (viewing bookings), Offers, Private offers, Campaigns, Blog, Agra Highlights, Reviews.

## Holding work

A lead or a WhatsApp chat can be held by nobody, by `owner`, or by a team member's email. Taking one is first-wins and never overwrites another person; handing over is a deliberate action. Holding is for sharing the work, not a permission: any Team member can still open anything a Team member can open.

## What we do not enforce

- There is no per-page view-only role. Team can change anything on the pages they can open. If you want some people to see but not change (for example money on bookings), tell me and it becomes a third role.
- The owner password is the emergency way in. Keep it in a password manager and change it with `scripts/admin-password.mjs` if more than one person has ever known it.

## Who did what

The audit log (owner-only) records, with the person's name or `owner`: sign-ins, failed sign-ins, sign-outs, team changes (invite, suspend, reactivate, remove, force sign-out), booking status changes and notes, tour and offer changes, lead import, export and merge (and undo), erasing or unsubscribing a person, WhatsApp deletions, purge and automatic-reply on/off, and campaign test, schedule, send and cancel. It cannot be edited or deleted from the admin.

Not in the audit log: taking or handing over a lead or chat, and lead notes. The lead's history and the chat's sender names show who did those.
