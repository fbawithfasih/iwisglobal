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
| 3e.4 | Today: a tile with a number above zero has a soft tint (orange for waiting, blue for follow-ups, green for bookings to confirm); at zero it turns green with a tick (see 3h.1) | | |
| 3e.5 | Owner overview: confirmed, paid and booked are green, cancelled is rose, upcoming and chats are blue, still open and still to collect are orange | | |
| 3e.3 | Each list shows a helpful empty message when it has nothing | | |

## 3h. Today as a picture

| # | Check | Who | Result |
|---|---|---|---|
| 3h.1 | Today: the greeting follows the India hour; the four "needs you" tiles are always coloured (orange chats, rose leads, blue follow-ups, violet bookings to confirm) and a tile at zero turns green with a tick and "All clear" | | |
| 3h.2 | Today, "The week ahead": seven columns, bar height is the number of trips, green means everything ready and orange means something to prepare; click a day (or use the arrow keys) and that day's trips list below; hover or focus shows the sentence "30 Oct: 3 trips, 7 guests, 2 to prepare" | | |
| 3h.3 | Each trip card shows five segments (pickup, guide, driver, tickets, balance) and "4 of 5 ready", with the missing items named | | |
| 3h.4 | "Enquiries and bookings": totals with the change against the previous period, 7 / 14 day switch, hover shows that day's numbers, "Show as a table" has the same figures. The numbers match the Leads list (enquiries, spam left out) and the bookings made that day | | |
| 3h.5 | "Longest waiting": each row has a bar (fills over 24 hours) and a label, Under 1 h, 1 to 4 h or Over 4 h | | |
| 3h.6 | Phone: nothing scrolls sideways, the week columns stay readable (Tmrw, short status) | | |

## 3i. Bookings as a picture

| # | Check | Who | Result |
|---|---|---|---|
| 3i.1 | Bookings: four coloured tiles (Needs attention, Waiting for you, Upcoming, Completed) are the views; the open one has a violet ring; Confirmed, Cancelled and All are small buttons under them | | |
| 3i.2 | "The next 14 days": a column per day, green when everything is ready, orange when something needs preparing; hover shows "30 Oct: 3 trips, 7 guests, 2 to prepare"; clicking a day lists that day's live trips with a "Trips on ..." chip and Show all clears it | | |
| 3i.3 | "All bookings by status": one bar and a list with counts and percentages; each line opens that view | | |
| 3i.4 | Every booking shows how near it is (Today, Tomorrow, In 5 days, 2 days ago) and has a coloured edge for its status | | |
| 3i.5 | Phone: nothing scrolls sideways, there is one "+ Booking" button (in the top bar) | | |

## 3j. Leads as a picture

| # | Check | Who | Result |
|---|---|---|---|
| 3j.1 | Leads: four coloured tiles (Needs attention, New and unanswered, Follow-ups due, Mine) are the views; green with a tick at zero; the open one has a violet ring; the other views are small buttons under them | | |
| 3j.2 | "Pipeline": open leads per stage as bars; clicking a stage lists those leads (All open view with that stage); hover shows the count | | |
| 3j.3 | "Where enquiries come from": last 30 days by channel, spam left out; clicking a channel lists its leads | | |
| 3j.4 | "How fast we reply": typical wait, how many were answered within the hour, and a warning when many enquiries have no reply recorded (the card must not look green when most are unanswered) | | |
| 3j.5 | Each lead card has a coloured edge for its stage, an initial in a violet circle, and pastel stage and hot/warm/cold pills | | |

## 3k. WhatsApp as a picture

| # | Check | Who | Result |
|---|---|---|---|
| 3k.1 | WhatsApp: four coloured tiles are the chat filters (Needs a person, Mine, Staff handling, All chats); the open one has a ring; Needs a person turns green with a tick at zero | | |
| 3k.2 | "Overview" (open when no chat is open, folded when one is): "Messages per day" grouped columns for the last 14 days, guests violet and us orange, hover readout, table view; the numbers leave out reactions, edits and deletions | | |
| 3k.3 | "Waiting for a reply" by Under 1 h, 1 to 4 h, Over 4 h, and "Reply windows" (open, closing under 2 h, closed); the totals match the chats shown with a Waiting line | | |
| 3k.4 | Each chat in the list has an initial in a violet circle, a coloured edge for its state, a pastel state label; messages we sent are tinted green, guest messages are white | | |
| 3k.5 | Everything else still works: Take it, Hand over, Send, drafts, templates, Delete this chat | | |

## 3l. Custom trips as a picture

| # | Check | Who | Result |
|---|---|---|---|
| 3l.1 | Custom trips: a status pill (Live for guests / Off) and four tiles: Switch (green when on, orange while things are missing), Vehicles offered, Stops offered, Fees to check (red while any offered stop has ticket fees not checked for over 30 days); each tile jumps to its section | | |
| 3l.2 | "Ticket fees: how recent": one bar per stop, green within 30 days, orange within 90, red older or never checked; a stop with no fees says "No ticket fee"; clicking a stop jumps to its fees | | |
| 3l.3 | "Vehicle rates": Agra day and Delhi return bars per vehicle, "Not offered" on the ones hidden from guests, the guide rate underneath | | |
| 3l.4 | "How much of a day each stop takes": visit and drive stacked against the day length | | |
| 3l.5 | All the forms still save (switch, guide and limits, vehicles, stops, fees) and the green message shows after each | | |
| 3l.6 | At 320 px wide nothing scrolls sideways | | |

## 3m. Tours as a picture

| # | Check | Who | Result |
|---|---|---|---|
| 3m.1 | Tours: four tiles (Published, Drafts, Featured, Listings to finish); the last is red while a published tour is missing a photo, summary, description, three highlights, two itinerary steps or a price, and green when none is | | |
| 3m.2 | "How each tour is selling": a bar per tour for bookings in the last 90 days (cancelled ones left out, ones waiting for you counted), with guests and the average rating from approved reviews; clicking a tour opens Bookings searched for it | | |
| 3m.3 | Each tour card has its photo (or "No photo"), price, bookings and rating, five or six segments for how complete the listing is with the missing items named, and a coloured edge (green published, grey draft) | | |
| 3m.4 | Edit, View on site and Publish / Unpublish still work (Unpublish asks first) and the green message shows afterwards | | |
| 3m.5 | At 320 px wide nothing scrolls sideways | | |

## 3n. Hotels as a picture

| # | Check | Who | Result |
|---|---|---|---|
| 3n.1 | Hotels: a status pill (Live for guests / Off) and four tiles: Switch (steps done out of 6 while off), Hotels loaded (with how old the content is), Hotel bookings, Need you (red while a payment is stuck or a failed booking has no refund recorded, green with a tick when none) | | |
| 3n.2 | "Before it can go live": six steps (keys, content, markup, EUR to INR, EUR to USD, switched on), each ticked or with what to do; the meter matches the tile | | |
| 3n.3 | "Hotel content": hotels loaded, how fresh (green within 7 days, orange within 30, red older, never, or the last refresh failed), the last error shown in red when there is one; no key or secret appears anywhere | | |
| 3n.4 | "Hotel bookings by status": one bar and a list (Booked, Cancelled, Paid waiting, Paid stuck, Failed) that adds up to the table below | | |
| 3n.5 | Everything still works: Switch on and off (asks first to switch off), Save pricing, Refresh content, Test a booking, Cancel and refund (asks first), and the green message after each | | |
| 3n.6 | The old Summary is now under "Technical details" and still shows destination, currency, last refresh, key and secret state (present or missing only) and the server | | |

## 3p. Offers as a picture

| # | Check | Who | Result |
|---|---|---|---|
| 3p.1 | Offers: four tiles: Running, Ending soon (orange while a running offer ends within 7 days, green with a tick when none), Scheduled, Bookings with an offer (with the coupon and automatic split) | | |
| 3p.2 | "Which offers guests use": one bar per offer, busiest first, with the booking count in words; Ended, Scheduled and Off offers carry a status label, not just a paler colour; hover or focus shows a short tooltip | | |
| 3p.3 | Each offer card: status, a timing pill (Ends in N days, Last day today, Starts tomorrow, Ended N days ago, No end date, Switched off), the value, code or "Automatic", tours, booking window and conditions, uses, and "Nobody has used it yet" on a running offer with no bookings | | |
| 3p.4 | Running offers are listed first, the one ending soonest on top, then Scheduled, Ended, Off | | |
| 3p.5 | Edit still opens the offer; creating, editing and deleting an offer work as before; no money totals appear on the page | | |
| 3p.6 | 320 px: no sideways scroll; keyboard focus reaches every bar and Edit button | | |

## 3q. Private offers as a picture

| # | Check | Who | Result |
|---|---|---|---|
| 3q.1 | Private offers: four tiles: Waiting for payment (orange when one has waited 7+ days), Balance to collect, Paid in full, Need you (red when a paid receipt email did not go out or an offer cannot be read, green with a tick when none) | | |
| 3q.2 | "Where the offers stand": one bar and a legend (Paid in full, Booking amount paid, Waiting for payment, Closed, Unreadable) that adds up to the number of offers | | |
| 3q.3 | Each offer is a card with its guest, a status label, "Created N days ago", a "Waiting N days" label after 7 days, the chosen option, a paid-percent bar with the paid amount and balance once a payment is in, and Copy link (the button says Copied) | | |
| 3q.4 | A paid payment whose receipt email shows "not sent yet" or "sending / interrupted" puts a red message on that card and counts in Need you | | |
| 3q.5 | Order: unreadable first, then balance to collect, then waiting (oldest first), then paid, then closed | | |
| 3q.6 | The payments table is still there per offer (kind, amount, status, payer, paid at, Razorpay id, emails); at 320 px it scrolls inside its box and can be reached with the keyboard; the page itself does not scroll sideways | | |

## 3r. Sitemap dates

| # | Check | Who | Result |
|---|---|---|---|
| 3r.1 | After the next deploy, `/sitemap-0.xml` has a `<lastmod>` on blog posts, tours, guides, attractions and on /blog, /tours, /guides and /agra, and none on pages with no real date (home, terms, privacy) | | |
| 3r.2 | A blog post edited in the admin and then deployed shows its new date in the sitemap | | |
| 3r.3 | Search Console, Sitemaps: the sitemap is read without errors | | |
| 3r.4 | The next morning, GitHub Actions shows a "Deploy to Cloudflare Pages" run triggered by the schedule (about 20:30 UTC) that finished green; a blog post published the day before is in `/sitemap-0.xml` | | |

## 3s. Reviews as a picture

| # | Check | Who | Result |
|---|---|---|---|
| 3s.1 | Reviews: four tiles: To check (orange, with how long the oldest has waited; green with a tick when none), On the website (with how many are hidden), Average rating (approved reviews only), Ready to ask (orange when trips are over 14 days old) | | |
| 3s.2 | "How guests rate us": five bars (5 stars down to 1) with the count in numbers; hover or focus shows "N stars: X reviews"; the counts add up to the approved reviews | | |
| 3s.3 | Review cards: stars, status label, guest, tour, trip date, comment; Approve and Hide still work (asks nothing, shows the green message) | | |
| 3s.4 | "Ask for a review": each trip shows "Trip was N days ago" (orange after 14 days); Email, WhatsApp and Skip still work; an email result shows a green or red message | | |
| 3s.5 | 320 px: no sideways scroll; every bar and button reachable by keyboard | | |

## 3t. Campaigns as a picture

| # | Check | Who | Result |
|---|---|---|---|
| 3t.1 | Campaigns: four tiles: Drafts, Scheduled or sending (orange while one is going out), Emails sent (with how many campaigns finished), Need a look (red when a campaign has a recorded error, failed sends or delivery to watch; green with a tick when none) | | |
| 3t.2 | "Emails sent per campaign": a bar per campaign that has sent (latest eight), the count in words, a tooltip with sent, delivered, bounced, spam and clicks | | |
| 3t.3 | Each campaign card: status, created and scheduled time, a progress bar ("30 of 100 sent"), a delivery label with delivered, bounced and spam counts and percentages and link clicks; failed and skipped counts; a recorded error in red | | |
| 3t.4 | Delivery label: healthy normally; "keep an eye on it" from 0.1 percent spam complaints or 2 percent bounces or any failed send; "problem" from 0.3 percent complaints or 5 percent bounces | | |
| 3t.5 | Order: sending, scheduled, drafts, sent, cancelled; newest first inside each. "New campaign" and "Email subscribers" still work; the campaign page itself is unchanged | | |
| 3t.6 | 320 px: no sideways scroll; bars and cards reachable by keyboard | | |

## 3u. A paid private offer is a booking

| # | Check | Who | Result |
|---|---|---|---|
| 3u.1 | Pay a test private offer in full: one booking appears in Bookings with the guest's name, email and phone, the travel day, the number of travellers, the amount paid, source "private_offer" and the tour shown as "Private offer" | | |
| 3u.2 | Pay a booking amount, then the balance on the same offer: still one booking; "Amount paid" goes from the booking amount to the full amount and it shows as full; status and pickup time you set are kept | | |
| 3u.3 | The booking page for it shows no "Balance payment" box (the balance is paid on the guest's offer link) and says "booking amount", not "25% deposit" | | |
| 3u.4 | It appears on Today on its travel day and in review requests after the trip ("Private offer" as the tour) | | |
| 3u.5 | The lead for the guest moves to Booked after a full or balance payment, and links to the booking | | |
| 3u.6 | An offer made with `"internal": true` creates no booking when paid; an offer with two different days in its date label and no `travelDate` creates none and emails you about it | | |

## 3v. Blog as a picture

| # | Check | Who | Result |
|---|---|---|---|
| 3v.1 | Blog: four tiles: Published, Drafts, To update (published posts not updated for 180 days; green with a tick when none), To finish (published posts missing a cover photo, a title up to 60 characters, a description of 70 to 160 characters or a link to a tour; green with a tick when none) | | |
| 3v.2 | "Posts published per month": the last six months, a bar and the count for each month (empty months shown), hover or focus shows "Oct 26: 2 posts published"; drafts are not counted | | |
| 3v.3 | Post cards: cover thumbnail (or "No photo"), title, status, category, published date, reading time, "Updated N days ago", "Worth a refresh" after 180 days, a four-step check bar and the "Add: ..." labels for what is missing | | |
| 3v.4 | Live posts first (newest first), then drafts; Edit, View on site (live posts only, opens a new tab) and Publish / Unpublish work as before (Unpublish asks first) | | |
| 3v.5 | 320 px: no sideways scroll; bars and buttons reachable by keyboard | | |

## 3w. Lead report as a picture

| # | Check | Who | Result |
|---|---|---|---|
| 3w.1 | Lead report: the date range sits at the top right and still works; four tiles: Leads (and how many channels), Bookings (with the percentage of leads booked), Top channel (with its leads and bookings), No spend entered (orange when a channel with leads has no spend entered, green with a tick when none) | | |
| 3w.2 | "From lead to booking": four bars (Leads, Quote sent, Deposit paid, Booked) with the count, the share of all leads and the share of the step before; the numbers match the By channel table totals | | |
| 3w.3 | "Leads by channel": a bar per channel with leads, booked and the first-reply time; the green part of each bar is the share that booked; hover or focus shows the same in a tooltip | | |
| 3w.4 | The tables (By channel, By campaign, Email campaigns, Marketing spend) are all still there with every column; adding and removing a spend entry still works, with a green or red message | | |
| 3w.5 | With no leads in the range the charts are hidden and the tiles say so; 320 px: no sideways scroll except inside the tables, which scroll in their own box | | |

## 3o. OpenAI Ads pixel

| # | Check | Who | Result |
|---|---|---|---|
| 3o.1 | From an EU, UK or Swiss address, on a first visit nothing from `bzrcdn.openai.com` is requested; after Accept the pixel loads once; after Reject it never loads | | |
| 3o.2 | Elsewhere (for example India) the pixel loads by default and not when the visitor has chosen Reject in Cookie settings | | |
| 3o.3 | The cookie banner and the privacy page (all four languages) name OpenAI next to Google, Meta and Metricool | | |
| 3o.4 | In OpenAI Ads, the data source shows the pixel as receiving page views (allow a few minutes) | | |
| 3o.5 | Private pages (sign-in, account, private offers) do not load it | | |
| 3o.6 | With debug on, each page load sends one `page_viewed`; submitting the enquiry form sends `lead_created`; a tour page sends `contents_viewed`; starting checkout sends `checkout_started`; a paid booking sends `order_created` once (amount in whole minor units, e.g. 1200050 for 12,000.50) | | |
| 3o.7 | A tap on the WhatsApp button sends the custom event `whatsapp_clicked`, not `lead_created` | | |
| 3o.8 | After Reject in Cookie settings, no more events are sent and the `__oppref` / `__obref` cookies are gone | | |
| 3o.9 | In OpenAI Ads Manager, create conversion events from the base events Lead created, Order created, Checkout started, Contents viewed and the custom `whatsapp_clicked`, then link them to the campaign (owner step) | | |

## 3f. Keyboard and screen reader (do this with a person; 20 minutes)

Keyboard only (put the mouse away). On the phone, switch on VoiceOver (iPhone) or TalkBack (Android) for the second half.

Pre-checked on 28 Oct 2026 by a scripted keyboard run in a real browser (3f.1 to 3f.4, 3f.6, 3f.8 and the phone menu: skip link, focus ring on every stop, order, `/` search, bell open and close, dialog focus trap and return, every field named, closed phone menu skipped by Tab). The browser's accessibility tree (what a screen reader reads from) was also checked on Today, Tours, Campaigns, New booking and a booking page: headings in order, landmarks present, every field and button named, and the findings fixed (row buttons now name their item, list titles read "Tours (1)", review stars are announced as "4 out of 5", Today's regions are separate). The part only a person can do is the screen reader half (3f.9 to 3f.11) and a quick human look at the rest.

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

## 3g. "Saved" messages

| # | Check | Who | Result |
|---|---|---|---|
| 3g.1 | Booking page: Save itinerary, Update status and Add note each show a short green message at the bottom ("Itinerary saved", "Status updated", "Note added"); it hides itself after about 5 seconds, or with Dismiss or Esc | | |
| 3g.2 | Reload the page: the message does not come back | | |
| 3g.3 | Lead page (stage, note, follow-up, take, assign, done) and WhatsApp (send reply, template, take over, hand over, give back, discard): the same short message | | |
| 3g.4 | A failed action shows its error, never "Saved" | | |
| 3g.5 | The booking page does not scroll sideways on a phone (the Driver box fits the screen) | | |
| 3g.6 | Same message on the other pages: create or publish/unpublish a tour, blog post, offer or highlight ("Created", "Published", "Saved", "Deleted"); add a lead or take one on Leads; create a manual booking; approve or hide a review; create a campaign and save its name, audience or wording. Nothing shows when a form is refused or nothing changed | | |
| 3g.7 | Booking page, balance link and review request "on WhatsApp": if the guest wrote in the last 24 hours the message is sent from the backend and shows in the WhatsApp inbox ("Balance link sent on WhatsApp", "Review request sent on WhatsApp"); if not, a red message says why and a small "Or open it in WhatsApp on this phone instead" link appears | | |
| 3g.8 | The plain WhatsApp button (booking page, lead page, Leads list) opens the guest's chat in the inbox when one exists, and the phone app only when there is none | | |
| 3g.9 | Guest side (My bookings and the booking confirmation page): once a driver is saved on a confirmed booking, the driver's name and a tappable phone number show under the pickup time, in all four languages | | |
| 3g.10 | At 320 px wide no public page and no admin page scrolls sideways (the footer newsletter box and the Custom trips fees table were the last two) | | |

## 4. Bookings

| # | Check | Who | Result |
|---|---|---|---|
| 4.1 | Opens on Needs attention; every other view opens with a sensible count | | |
| 4.2 | Search by guest name, email, phone and booking id finds the booking | | |
| 4.3 | Open a booking, change status, add a note: the note shows your name; the change appears in the audit log | | |
| 4.4 | Set pickup time, guide and vehicle; they show on Today | | |

## 4b. Driver details

| # | Check | Who | Result |
|---|---|---|---|
| 4b.1 | Open a booking: under Itinerary / logistics there is a "Driver" box with Driver name and Driver phone | | |
| 4b.2 | Save a driver; "Call driver" (and "WhatsApp driver" for a number with +) appear and work on a phone | | |
| 4b.3 | "Send pickup details on WhatsApp" asks first, then sends through the WhatsApp Business API; the message appears in the WhatsApp inbox and a note is added to the booking (it must not open WhatsApp on the phone) | | |
| 4b.5 | For a guest who has not written in 24 hours the approved template `iwis_pickup_details` goes out; the message includes the driver's name and phone | | |
| 4b.4 | Today: the trip card shows the driver and phone; "Assign driver" shows only when no driver is set | | |

## 5. Leads

| # | Check | Who | Result |
|---|---|---|---|
| 5.1 | A new website enquiry appears under Needs attention with a waiting time | | |
| 5.2 | Take it: it shows your name; another person cannot take it from you | | |
| 5.3 | Hand over to another person; the history shows who did it | | |
| 5.4 | Export respects people who unsubscribed | | |
| 5.x | A guest who already has a booking (trip ahead, or ended in the last 60 days) writes on WhatsApp, Instagram, Facebook or email: no new lead and no "New lead" email; the message shows on their booked lead's timeline ("Contact via WhatsApp"). A contact form from the same guest still opens a lead | | |

## 6. WhatsApp

| # | Check | Who | Result |
|---|---|---|---|
| 6.1 | A test message from your phone appears in the inbox within a minute | | |
| 6.2 | Take it, reply, and the reply shows your name as sender | | |
| 6.3 | A chat the agent handed over shows on Needs attention | | |
| 6.x | A guest reacts to a message with an emoji (or edits or deletes a message): the chat does not show "Waiting", is not counted on Today or in the bell, and no reply is asked for. A real message, photo or voice note still does | | |

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
