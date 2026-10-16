# Hotelbeds certification pack: iwisglobal.com (Agra hotels)

Prepared 2026-10-16 for the owner to review and send. Nothing here has been sent to Hotelbeds.
Design: `docs/superpowers/specs/2026-10-16-hotel-booking-design.md`. Plan: `docs/superpowers/plans/2026-10-16-hotel-booking-plan.md`.

## 1. Before you send anything (owner checklist)

1. Merge the hotel pull requests (checkout, voucher, cancellation, tour step, translations) and deploy with `npm run deploy`.
2. Apply `schema_hotels.sql` to the production database if it has not been applied (`wrangler d1 execute iwisglobal-bookings --remote --file=schema_hotels.sql`).
3. Set the Cloudflare secrets `HOTELBEDS_API_KEY`, `HOTELBEDS_SECRET` (test key for now) and `HOTEL_SYNC_SECRET` (also as a GitHub secret, for the weekly content sync).
4. In `/admin/hotels` set the markup, the EUR to INR and EUR to USD rates, and press **Refresh content**. Hotels only switch on when markup is above 0, the EUR to INR rate is set and content is loaded.
5. Run the scenarios in section 5 and keep the logs.
6. Read the two open points in section 6 and decide.
7. Send the email in section 7 with the logs attached.

## 2. Workflow (what the site does)

1. **Availability.** One call per search (`POST /hotel-api/1.0/hotels`) carrying every room and all stored Agra hotel codes (up to 2000). Rooms with the same adults and children's ages share one occupancy; rooms that differ get separate occupancies. Children's ages are always sent. Availability is never repeated between steps.
2. **CheckRate.** Only when the chosen rate has `rateType = RECHECK` (`POST /hotel-api/1.0/checkrates`, one rate key per call). A `BOOKABLE` rate goes straight to booking. If the price or availability changed, the guest sees the new price and must confirm again; nothing is charged at the old figure.
3. **Booking.** After the guest has paid in full (`POST /hotel-api/1.0/bookings`, timeout 70 seconds, gzip requested on every request). If the call fails or times out, we look the booking up by client reference before deciding anything; if Hotelbeds holds no booking the guest is refunded in full. A booking is never posted twice for the same payment.
4. **Cancellation.** From the admin screen (`DELETE /hotel-api/1.0/bookings/{reference}?cancellationFlag=CANCELLATION`). The guest is refunded what the hotel's cancellation policy allows; if Hotelbeds reports its own fee and it is larger than ours, the larger fee is used.

## 3. Commercial and display decisions

| Topic | What we do |
| --- | --- |
| Opaque / packaged rates | Never shown (`packaging = true` rates are dropped). |
| Hotel selection | Only hotels in our stored Agra content; minimum stars and an exclusion list are set in `/admin/hotels`. |
| Price shown | Hotelbeds net x (1 + one markup percent from admin), converted to INR or USD with the admin rates and rounded up to a whole unit. The price is always worked out on the server. |
| Rate comments | Always shown above the Pay button. If they cannot be loaded, the Pay button is disabled. |
| Cancellation terms | Shown to the guest as the date and time until which cancellation is free (taken from the first policy the API returns, in India time because the hotels are in India), or "non-refundable" when there is no free period. The refund on a later cancellation is worked out from the full policy list. |
| Source market | Not sent; every guest sees the same prices. |
| Payment | The guest pays the full amount (Razorpay) before we book. Any failure after payment is refunded in full. |
| Voucher | Printable page and email. Shows hotel name and address, category, destination and phone, holder, guests per room with children's ages, Hotelbeds reference and our reference, dates, room, board, rate comments, and the exact line: *Payable through <supplier name>, acting as agent for the service operating company, details of which can be provided upon request. VAT: <supplier VAT> Reference: <booking reference>*. It never shows a price. The supplier name and VAT come from the `invoiceCompany` of the booking response. |
| Non-breaking changes | Unknown response fields and optional parameters are ignored. |

## 4. Content, demo and test notes

- **Content.** Hotel names, descriptions, photos, facilities (including paid ones), categories, addresses and phones are copied into our database and refreshed every Monday at 03:00 UTC by the "Hotel content sync" GitHub workflow (`.github/workflows/hotel-content-sync.yml`), and on demand from `/admin/hotels`.
- **Hotels missing from the stored content are not shown.** The spec mentioned a hotel-detail fallback; we chose not to build it, so no hotel is ever displayed without its content. Tell Hotelbeds this plainly if they ask.
- **Crawler.** Not implemented. We will implement it only if Hotelbeds asks for it in the certification request.
- **Demo URL.** `https://www.iwisglobal.com/hotels`, once the switch in `/admin/hotels` is on. Until then the page returns 404 to guests and shows a preview banner to a signed-in admin.
- **How to book with the test key.** Open `/hotels`, choose dates at least a day ahead, pick a room, enter guest names, and pay with a Razorpay test card. The confirmation page redirects to the voucher at `/hotels/voucher?booking=<id>`, and the same link is emailed to the guest.
- **Where the voucher is.** `/hotels/voucher?booking=<id>` (unguessable id, not indexed, printable).
- **Languages.** English, Spanish, French and German (machine-translated; see `docs/hotel-translations-review.csv`). The supplier's "Payable through" line stays in English.

## 5. Certification scenarios (run these on the test key)

The script `scripts/hotelbeds-cert/run.ts` runs the scenarios against the **test** server only and saves every request and response as JSON. It refuses to run against any other server, never writes the key or secret to the logs, and cancels everything it books, even when a scenario fails. It does not touch the website, its database or Razorpay.

```
export HOTELBEDS_API_KEY=...   # the test key
export HOTELBEDS_SECRET=...
export HOTEL_CODES=1234,5678   # optional: Agra hotel codes, as listed in /admin/hotels. Without it the script searches destination AGR.
sh scripts/hotelbeds-cert/run.sh
```

Optional: `CHECK_IN=2026-12-10` and `NIGHTS=2` (default: 30 days ahead, 2 nights).

| Scenario | What the script does | What to look for in the logs |
| --- | --- | --- |
| A. One room, 2 adults | Availability, then booking (CheckRate first if the rate is `RECHECK`), then the booking detail | One availability call; the booking has the supplier name and VAT |
| B. Two rooms, different occupancies | Availability with two occupancies, CheckRate on a `RECHECK` rate if there is one | Two occupancy nodes in the request. Search only, see section 6 |
| C. Children with ages | Availability and booking with two children aged 5 and 9 | `paxes` with `type: CH` and ages in both requests |
| D. A `RECHECK` rate | Availability, CheckRate, booking with the rate key CheckRate returned | A checkrates call before the booking |
| E. A `BOOKABLE` rate | Availability, then booking directly | **No** checkrates call for this rate |
| F. Cancellation | Cancels every booking the script made | `DELETE ... cancellationFlag=CANCELLATION`, HTTP 200 |

`SUMMARY.txt` in the log folder lists what was booked, the supplier details Hotelbeds returned and the result of each cancellation. If a cancellation fails the summary says so: cancel that booking by hand in the Hotelbeds test back office. If scenario D or E finds no suitable rate, widen the dates or `HOTEL_CODES` and run again. The script has been tested against stubbed responses only. It has not yet run against the real test API.

Also do one full pass through the website with the test key (search, pay with a test card, check the voucher and the emails) and one cancellation from `/admin/hotels`. Keep screenshots of the voucher.

## 6. Open points to decide before you send

1. **Rooms with different occupancies cannot be booked on the site yet.** Search handles them (scenario B), but the booking holds one rate key, so checkout refuses a party whose rooms differ and asks the guest to book each room type separately. Hotelbeds may expect a full booking for this scenario. Decide whether to say so in the email (as below), or build multi-rate-key booking first. It is a larger change to the payment and refund paths.
2. **Hotel-detail fallback is not built** (section 4). The spec listed it; the plan dropped it. Hotelbeds may ask for it.
3. **Live rehearsal after certification** (section 8) needs real money and live keys.

## 7. Request email (draft)

To: apitude@hotelbeds.com
Subject: Certification request: IWIS Global (iwisglobal.com), Agra hotels

Hello,

We have built a hotel booking flow for Agra on https://www.iwisglobal.com/hotels using the Hotels API (Availability, CheckRate, Booking, Booking detail and cancellation) and the Content API, and would like to start certification. Our test API key is [your API key reference / account name].

Workflow: one Availability call per search with all rooms (separate occupancies where they differ) and all Agra hotels; CheckRate only for rates with rateType RECHECK; then Booking after the guest has paid. Children's ages are always sent. gzip is requested on every call and the booking call waits up to 70 seconds. If a booking call fails or times out we look the booking up by client reference before refunding.

Display: opaque/packaged rates are never shown. Rate comments are shown before the guest pays, with cancellation terms in India time. The voucher shows the hotel name and address, category, destination and phone, holder and guest names with children's ages, our reference and the Hotelbeds reference, dates, room, board, rate comments and the required "Payable through ..." line using the supplier details from the booking response. It shows no price.

Content: hotel content is stored in our database and refreshed weekly. Hotels missing from our stored content are not shown, so we have not used the hotel-detail fallback. We have not implemented the crawler; please tell us if you require it.

Rooms with different occupancies can be searched, but our checkout currently books one room type per booking. [Keep or remove this sentence after you decide point 1 above.]

Attached: the request and response logs for these scenarios on the test key: one room with 2 adults; two rooms with different occupancies (search only); children with ages; a RECHECK rate; a BOOKABLE rate; and cancellation. Demo: https://www.iwisglobal.com/hotels [add once the switch is on, or a temporary admin login].

Please let us know what else you need.

Kind regards,
[Name], IWIS Global

## 8. After Hotelbeds issues live keys

1. Replace the three Cloudflare values: `HOTELBEDS_API_KEY`, `HOTELBEDS_SECRET`, `HOTELBEDS_BASE_URL=https://api.hotelbeds.com`, then redeploy.
2. Press **Refresh content** in `/admin/hotels`.
3. Live rehearsal: one booking about six months ahead, 2 adults and 2 children, a refundable rate with no cancellation fee. Send Hotelbeds the voucher and the price, then cancel it from `/admin/hotels` and confirm both the refund in Razorpay and the cancellation at Hotelbeds.
4. Only then switch hotels on for guests.
