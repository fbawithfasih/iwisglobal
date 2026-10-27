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

## 3b. Search and the sidebar

| # | Check | Who | Result |
|---|---|---|---|
| 3b.1 | The sidebar shows your name and role (Owner or Team) above Log out | | |
| 3b.2 | Type a guest's name in the sidebar search: bookings, leads and WhatsApp chats for that person are listed, each opens the right page | | |
| 3b.3 | Search a phone number two ways (with +91 and without): the same person is found | | |
| 3b.4 | Press `/` on a desktop page: the search box is focused; typing `/` inside a form field still types a slash | | |
| 3b.5 | On a phone the top bar has a Search link and the menu has the search box | | |

## 3c. The bell ("waiting for you")

| # | Check | Who | Result |
|---|---|---|---|
| 3c.1 | The bell shows a red number equal to chats waiting + leads needing attention + bookings to confirm on the Today page | | |
| 3c.2 | Click the bell: a panel lists each kind with its count; each line opens the right list; Esc or a click elsewhere closes it | | |
| 3c.3 | Reply to the waiting WhatsApp chat: within about a minute the number goes down without reloading | | |
| 3c.4 | The browser tab title starts with the number, for example "(3) Today" | | |
| 3c.5 | On a phone the top bar (Menu, Search, bell, + Booking) fits on one line | | |

## 3d. Confirm dialog

| # | Check | Who | Result |
|---|---|---|---|
| 3d.1 | Campaign page: "Send now" opens a dialog naming the number of subscribers; Cancel and Esc send nothing | | |
| 3d.2 | Tours list: Unpublish on a published tour asks first; publishing a draft does not | | |
| 3d.3 | Blog post, offer, Agra card: "Delete" asks you to type DELETE; the button stays grey until you do | | |
| 3d.4 | Booking page: cancelling a custom trip asks you to type CANCEL | | |
| 3d.6 | Blog list: Unpublish asks first; Publish does not | | |
| 3d.5 | After closing the dialog the cursor is back on the button you pressed; it works with the keyboard only | | |

## 3e. Lists look the same

| # | Check | Who | Result |
|---|---|---|---|
| 3e.1 | Tours, Blog, Offers, Campaigns show the title with a count in brackets and the main button on the right | | |
| 3e.2 | Status pills use the same colours: green live/sent/approved, grey draft/off/hidden, blue scheduled, orange sending/pending, red cancelled/stuck | | |
| 3e.4 | Today: a tile with a number above zero has a soft tint (orange for waiting, blue for follow-ups, green for bookings to confirm); at zero it is white | | |
| 3e.5 | Owner overview: confirmed, paid and booked are green, cancelled is rose, upcoming and chats are blue, still open and still to collect are orange | | |
| 3e.3 | Each list shows a helpful empty message when it has nothing | | |

## 3f. Keyboard and screen reader (do this with a person; 20 minutes)

Keyboard only (put the mouse away). On the phone, switch on VoiceOver (iPhone) or TalkBack (Android) for the second half.

| # | Check | Who | Result |
|---|---|---|---|
| 3f.1 | Press Tab once on any admin page: "Skip to main content" appears; Enter jumps past the menu | | |
| 3f.2 | Tab through the sidebar: every link shows a clear white ring; the order matches what you see | | |
| 3f.3 | Press `/`: the cursor lands in the search box; type a name and press Enter; results open with the keyboard | | |
| 3f.4 | Open the bell with Enter; Tab moves inside it; Esc closes it and the cursor returns to the bell | | |
| 3f.5 | On Leads, open a lead, change its stage and add a note using only the keyboard | | |
| 3f.6 | On Tours, press Unpublish: the dialog opens with the cursor on the red button; Esc cancels and the cursor returns | | |
| 3f.7 | On a blog post press "Delete this post": the red button stays disabled until DELETE is typed | | |
| 3f.8 | Create a booking from the keyboard: every field reachable, errors named next to the field | | |
| 3f.9 | VoiceOver / TalkBack: the Today board reads as headings and lists; the bell says how many are waiting | | |
| 3f.10 | VoiceOver / TalkBack: status pills are read as words (published, draft, scheduled), not colours | | |
| 3f.11 | Anything that traps the cursor, hides it, or cannot be reached: write it down here with the page | | |

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
