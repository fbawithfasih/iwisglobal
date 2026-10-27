# IWIS Global: admin modernisation changelog

What shipped, newest first, taken from the merged pull requests (#62 onward). Each entry is one pull request; the number is the pull request on GitHub.

## 2026-10-27

- Docs: draft first test campaign (English) with sources for each claim (#84)
- Docs: one-click unsubscribe confirmed on the live site (#83)
- One-click unsubscribe: replace Astro's cross-site form check with the same rule plus one narrow exemption for mail apps (#82)
- Docs: M4 closed by the owner; Bookings server time 1.12 s to 249 ms (#81)
- M4 speed: send database calls together (Bookings 3 rounds to 1, Leads 15 to 1), speed guard test, measured baseline (#80)
- Prepare one-click unsubscribe fix: origin check with a single exemption, tested, not yet wired in (#79)
- M6: accessibility fixes (0 axe violations), release and rollback runbook, QA checklist, access matrix, migration plan, changelog (#78)
- M5 (Owner overview): owner-only month and 30-day counts, money per currency, workload (#77)
- M5 (Today): admin Today board, landing page after sign-in (#76)
- M4: page speed baseline and Server-Timing on admin responses (#75)
- M4: shared empty-state card on the admin lists (#74)
- M4 (Bookings): show who wrote each booking note; note is audited (#73)
- M4 (Bookings): Needs attention view, views with counts, search, reason badges, empty states (#72)
- M4 (WhatsApp inbox): who is handling each chat, Take it, Hand over, Mine tab, who sent each reply (#71)
- M4 (Leads): who is handling each lead, Needs attention first, Take it, Mine and Unassigned views (#70)
- Owner password change script and team access doc step (#69)
- M3: staff accounts with Google sign-in, one admin gate, Owner and Team roles, team page (#68)
- M2 (audit log only): append-only admin audit log and viewer (#67)
- M1 step 2: shared component classes, style guide page, accessibility fixes (#66)

## 2026-10-26

- M1 step 1: admin shell with sidebar, phone drawer, design tokens and accessibility basics (#65)
- M0b step 1: Astro 5.18, Cloudflare adapter 12.6, React 4, Tailwind 6 (stays on Pages) (#64)
- M0: CI checks on pull requests, tested D1 backup/restore tools and recovery runbook (#63)
- Security: block the unused /_image endpoint; record M0 audit findings (#62)

