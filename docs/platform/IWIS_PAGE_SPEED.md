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

## How to read real admin timings

Every `/admin` response now carries `Server-Timing: app;dur=<ms>`: the time our code spent, mostly waiting on the database. In Chrome or Edge: open the admin page, press F12, Network tab, click the page request, Timing, "Server Timing". Please send me the numbers for Bookings, Leads, WhatsApp and Tours; anything over about 500 ms is worth fixing, and I will fix only what the numbers show.
