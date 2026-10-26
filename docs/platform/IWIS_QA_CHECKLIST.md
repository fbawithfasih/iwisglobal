# IWIS Global: release QA checklist

Status: 27 Oct 2026 (milestone M6). Run before a release that changes the admin, payments, sign-in or the database, and once now as the first sign-off. "Who" is the person who ran it; "Result" is Pass, Fail or Skipped with a note. Nothing below sends a real message or takes a real payment unless it says so.

Automated checks (run on every pull request, no action needed): type check with 0 errors, production build, and the test suites (permissions, audit log, leads, WhatsApp ownership, bookings views, Today board, owner overview, booking notes, backup tools, access matrix). Accessibility: 0 violations of WCAG 2 A and AA on 21 admin pages, desktop and phone (axe, 27 Oct 2026).

## 1. Signing in

| # | Check | Who | Result |
|---|---|---|---|
| 1.1 | Owner password signs in and lands on **Today** | | |
| 1.2 | A wrong password is refused with the same message each time | | |
| 1.3 | "Continue with Google" works for an invited address and lands on Today | | |
| 1.4 | A Google account that was never invited is refused | | |
| 1.5 | Sign out; the Back button does not show admin pages | | |
| 1.6 | Suspend a test team member; their next click sends them to sign-in | | |

## 2. Roles

| # | Check | Who | Result |
|---|---|---|---|
| 2.1 | As Team: the menu has no Team, Audit log, Owner overview, Custom trips | | |
| 2.2 | As Team: typing `/admin/team`, `/admin/audit`, `/admin/overview` is refused | | |
| 2.3 | As Team: hotels cannot be switched on or off; a person cannot be erased | | |
| 2.4 | As Owner: all of the above are available | | |

## 3. Today and Owner overview

| # | Check | Who | Result |
|---|---|---|---|
| 3.1 | Each tile's number equals the number of rows in the list it opens | | |
| 3.2 | Tours running today and tomorrow match Bookings for those dates | | |
| 3.3 | Owner overview money matches the booking amounts for the month | | |
| 3.4 | No section shows a dash or a warning banner | | |

## 4. Bookings

| # | Check | Who | Result |
|---|---|---|---|
| 4.1 | Opens on Needs attention; every other view opens with a sensible count | | |
| 4.2 | Search by guest name, email, phone and booking id finds the booking | | |
| 4.3 | Open a booking, change status, add a note: the note shows your name; the change appears in the audit log | | |
| 4.4 | Set pickup time, guide and vehicle; they show on Today | | |

## 5. Leads

| # | Check | Who | Result |
|---|---|---|---|
| 5.1 | A new website enquiry appears under Needs attention with a waiting time | | |
| 5.2 | Take it: it shows your name; another person cannot take it from you | | |
| 5.3 | Hand over to another person; the history shows who did it | | |
| 5.4 | Export respects people who unsubscribed | | |

## 6. WhatsApp

| # | Check | Who | Result |
|---|---|---|---|
| 6.1 | A test message from your phone appears in the inbox within a minute | | |
| 6.2 | Take it, reply, and the reply shows your name as sender | | |
| 6.3 | A chat the agent handed over shows on Needs attention | | |

## 7. Public site (guests)

| # | Check | Who | Result |
|---|---|---|---|
| 7.1 | Home, a tour page and the contact page load on a phone | | |
| 7.2 | A booking can be started up to the payment screen (do not pay) | | |
| 7.3 | The enquiry form creates a lead | | |
| 7.4 | The newsletter sign-up asks for confirmation by email (do not send a campaign) | | |

## 8. After the release

| # | Check | Who | Result |
|---|---|---|---|
| 8.1 | The two-minute check in `IWIS_RELEASE_AND_ROLLBACK.md` passes | | |
| 8.2 | `Server-Timing` on Bookings, Leads, WhatsApp and Tours under about 500 ms | | |

## Sign-off

| Date | Release | Signed off by | Notes |
|---|---|---|---|
| | | | |
