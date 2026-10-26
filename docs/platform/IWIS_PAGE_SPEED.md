# IWIS Global: page speed

Status: first measurements 26 Oct 2026 (milestone M4). Public site measured by Google's PageSpeed through the Ubersuggest tool; admin pages measured locally and, from this change on, in production through a `Server-Timing` header.

## Public site (home page, lab test)

| | Desktop | Mobile |
|---|---|---|
| First paint | 0.68 s | 2.3 s |
| Largest content paint | 1.2 s | 2.9 s |
| Total blocking time | 49 ms | 150 ms |
| Layout shift | 0 | 0.096 |
| Time to interactive | 1.3 s | 4.5 s |

What the test suggested: a redirect costs 190 ms on desktop and 630 ms on mobile; about 100 KB of JavaScript is not used on first load; 12 to 13 KB of CSS is unused. Mobile layout shift (0.096) is under the 0.1 "good" limit but close.

The apex domain `iwisglobal.com` redirects to `www.iwisglobal.com` (one hop, expected). I could not see from the build environment which redirect the test counted (the site is not reachable from there), so **nothing has been changed for it yet**. Next step is a look in a normal browser's network panel on a phone; if the only hop is apex to www, that is the cost of people typing the bare domain and is worth keeping.

## Admin pages (local build, nearly empty database)

HTML sent per page is small: 7 to 18 KB, 2 to 5 KB compressed (Leads is the largest at 18 KB; Bookings 10 KB; Tours 17 KB). Local server time was 7 to 35 ms per page, but the test database is almost empty, so this proves only that the pages themselves are light, not how they behave with real data.

Known cost that grows with data: the Bookings list loads every booking and filters, counts and searches in memory (fine for hundreds of bookings, to be revisited at several thousand).

## First real measurement (27 Oct 2026, owner's browser)

Bookings page, Server Timing `app` = **1.12 s** (waiting for server 1.43 s; Cloudflare edge only 18 ms), with only five bookings in the database. So it is not the amount of data: it is the number of database calls made one after another. The database lives in the US east (Cloudflare reports `ENAM`) and the page is served near you in India, so every call in a row costs a few hundred milliseconds.

What the Bookings page did: fetch bookings, then fetch tours, then fetch each tour's add-ons and prices, three rounds in a row. The Leads page was worse: it counted each of its 12 views with a separate query (about fifteen in a row). Today and Owner overview each did several in a row too.

**Fix (27 Oct 2026):** send independent queries together and cut needless ones.
- Bookings: bookings, tour names and add-ons in one round (3 calls together, was 3 rounds).
- Leads: all 12 view counts in one query (was 12), and the page's four loads together.
- Today and Owner overview: queries inside each section sent together.
- WhatsApp counts: two queries together.
`scripts/contacts-test/speed.ts` guards this: it gives every query a simulated 40 ms delay and fails if Bookings, lead counts, WhatsApp counts, Today or Owner overview need more than 1 to 3 rounds in a row.

Expected effect: roughly one round trip instead of three on Bookings, one instead of fifteen on Leads. Please re-measure after the release (same steps below) and send the numbers.

**Not done, needs a decision:** the admin always reads from the primary database (in the US) so a page never shows data older than a save. D1 also has read copies closer to you. Using them for admin page loads would cut each round trip a lot more, at the cost of a page occasionally showing data a few seconds old (for example a chat that arrived a moment ago). I have not changed this; say if you want it.

## How to read real admin timings

Every `/admin` response now carries `Server-Timing: app;dur=<ms>`: the time our code spent, mostly waiting on the database. In Chrome or Edge: open the admin page, press F12, Network tab, click the page request, Timing, "Server Timing". Please send me the numbers for Bookings, Leads, WhatsApp and Tours; anything over about 500 ms is worth fixing, and I will fix only what the numbers show.
