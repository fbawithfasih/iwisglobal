# Agra hotel booking with Hotelbeds — design

Date: 2026-10-16. Status: draft for owner review. No code written yet.

## Goal

Guests book a hotel in Agra on iwisglobal.com, pay online, and receive a voucher. Hotels come from the Hotelbeds Hotels API (Booking, Content and, if needed, Cache). The owner already has a test API key. Live access requires Hotelbeds certification.

Agreed with the owner:
- Offered in two places: a standalone `/hotels` search, and the hotel step of "Customise your Agra tour".
- The guest pays the full amount online (Razorpay) before we book with Hotelbeds.
- Price shown = Hotelbeds net rate × (1 + one markup percent set in admin), converted to INR or USD.
- The hotel is its own booking and its own payment. It is never merged into the custom-tour deposit.

Out of scope: destinations other than Agra, activities and transfers products, package/opaque rates, meal or room upsells beyond what the API returns.

## Constraints from Hotelbeds certification

Source: Hotelbeds "Certification process" page. Each item below is checked before live access.

1. Workflow is exactly: one Availability call, then CheckRate only when the chosen rate has `rateType = RECHECK`, then Booking. Availability is never repeated between steps.
2. One Availability call per search carries all rooms (separate occupancy nodes when occupants differ or children's ages differ) and as many hotels as possible (limit 2000 per call; 10 rates per CheckRate call).
3. Requests use gzip. The booking call has a timeout of at least 60 seconds.
4. Prices, dates, rooms, hotels, board, room type, stars and pagination are shown correctly. Children's ages are always sent when children are included.
5. Rate comments are shown to the guest before confirmation. Cancellation policies, if shown, match the API and use the hotel's local time.
6. If a source market is sent, only prices for that market are shown to that market.
7. Every confirmed booking produces a voucher with: hotel name and address (required); category, destination and phone (recommended); holder name, at least one guest name per room, children's ages; Hotelbeds reference (required), our reference, check-in and check-out, room type, board, rate comments; and the payment line "Payable through <supplier name>, acting as agent for the service operating company, details of which can be provided upon request. VAT: <supplier VAT> Reference: <booking reference>" using the `supplier` fields from the booking response. The price is not shown on the voucher.
8. Content (descriptions, images, facilities including paid ones, categories) is stored in our database and refreshed at least weekly. A hotel missing from our copy falls back to the hotel-detail call. The Hotelbeds crawler setup is implemented if requested in the certification request.
9. After certification: one live booking six months ahead (2 adults, 2 children, a refundable rate, no cancellation fee) with voucher and price sent to Hotelbeds, then cancelled.
10. The integration ignores new response fields and optional parameters (non-breaking changes).

## Architecture

New code only, following existing patterns (D1Like, `resolveEnv`, dictionary i18n, server-trusted pricing, claim-before-refund).

### `src/lib/hotelbeds.ts` (server only)
- Signs requests: `X-Signature` = SHA-256 hex of `apiKey + secret + unixSeconds`; headers `Api-key`, `Accept: application/json`, `Accept-Encoding: gzip`.
- Functions: `searchAvailability`, `checkRate`, `bookHotel`, `getBooking`, `cancelBooking`, `getHotelDetail`. Pure request building and response parsing is separate from `fetch` so it can be tested with stubbed responses, as in the custom-tour tests.
- Secrets in Cloudflare only: `HOTELBEDS_API_KEY`, `HOTELBEDS_SECRET`; `HOTELBEDS_BASE_URL` selects test or live. Read with the existing dual lookup (`resolveEnv`).

### `src/lib/hotelPricing.ts` (pure, shared)
- `sellPrice(net, markupPercent, fxRate, currency)` rounds up to whole rupees or dollars.
- Hotelbeds quotes in the contract currency (often EUR); the conversion rate and the markup are admin settings. The server alone computes the amount charged.

### Data (new schema file `schema_hotels.sql`)
- `hotel_content` (code, name, category_code, category_name, address, postal_code, city, phone, lat, lon, description, images_json, facilities_json, updated_at): Agra only.
- `hotel_settings` (key, value): `markup_percent`, `fx_eur_inr`, `fx_eur_usd`, `enabled`, `min_stars`, `excluded_codes`.
- `hotel_bookings` (id, status `quoted | paid | booked | failed | cancelled`, currency, rate_key, search_json, selected_json, net_cost, sell_total, order_id, payment_id, hb_reference, holder_name, email, phone, guests_json, cancellation_json, voucher_json, custom_trip_id nullable, created_at, updated_at).
- `hotel_content_sync` bookkeeping for the weekly refresh.

### Flow (server is the source of truth)
1. `POST /api/hotels/search` — validates dates (min lead time, max nights), rooms, adults, children with ages; one Availability call for all stored Agra hotel codes; returns hotels with room options, board, sell price, cancellation summary, rate comments ids. Nothing the browser sends sets a price.
2. `POST /api/hotels/rate` — for the chosen rate: CheckRate only if `RECHECK`; returns final price, cancellation deadlines, rate comments. Stores a short-lived `quoted` row holding rate key, net cost and sell total.
3. `POST /api/hotels/order` — guest details (holder, one name per room, children's ages) validated; Razorpay order for the stored sell total; order notes carry the hotel booking id.
4. `POST /api/hotels/verify` and the Razorpay webhook — verify signature, read the order back, atomically claim `quoted → paid`, call Hotelbeds Booking with a client reference and a 70 s timeout. On success: `booked`, store reference and supplier fields, send voucher email to guest and alert to owner. On refusal or timeout: confirm with `getBooking` by reference before deciding; if not booked, refund in full (claim first, undo if refund fails), status `failed`, tell the guest.
5. Cancel (admin, and guest request for later): look up the cancellation policy returned for this booking, compute the refundable amount on the server, call Hotelbeds cancel, then refund that amount (claim first). Never refund more than was paid.

### Pages and UI
- `/hotels` (React island for search form and results; server-rendered shell; SEO text) and `/hotels/book` (details, review, pay), `/hotels/voucher?booking=<id>` (unguessable id; printable voucher).
- Customise tour: the hotel step gains "Book a hotel for these nights" using the trip dates and guests. The existing "own hotel" and "arrange for me" options remain. Tour and hotel stay separate bookings and payments; the hotel booking row links to the trip id for admin.
- All guest text in `en/es/fr/de`; amounts through existing money helpers.

### Admin
- `/admin/hotels`: enable switch, markup percent, exchange rates, minimum stars and exclusions, content sync status and "refresh now", hotel bookings list with cancel and refund, failed bookings highlighted.
- Nav link in `AdminLayout.astro`. Bookings list shows hotel bookings under a clear label.

## Error handling and safety
- All prices and refund amounts are computed server-side; browser values are ignored.
- Idempotency: unique client reference per booking; atomic status claims; webhook as backstop; safe to retry.
- Money without a booking: never left; every failure path ends in a full refund or a booking.
- Timeouts: a timed-out booking call is resolved through `getBooking`, never assumed failed.
- PII: guest data only in D1; voucher link uses a random id; no secrets in logs.
- Page hidden (404 for guests) until the admin switch is on, as with the custom tour.

## Testing
- Unit tests with stubbed `fetch`: request signing, response parsing, occupancy building, pricing and rounding, refund calculation from cancellation policy.
- In-memory SQLite integration tests for the order, verify, failure-refund and cancel flows, matching the custom-tour test style.
- Browser check of the search, review and payment UI with Razorpay and Hotelbeds stubbed.
- Hotelbeds test environment: run the exact certification workflow and keep the request logs as evidence.
- First live booking (post-certification) is the end-to-end rehearsal; plan it like the custom-tour rehearsal.

## Milestones
1. Content sync, search page and admin settings (test key).
2. Rate check, guest details, payment, booking, failure refund.
3. Voucher, emails, cancel and refund, admin bookings.
4. Customise-tour integration, four languages, certification pack (workflow description, commercial decisions, demo URL, test log), then live rehearsal.

## Open items for the owner
- Hotelbeds account/contract details: supplier VAT line for vouchers comes from the API; confirm GST treatment of the markup with your accountant.
- Whether to exclude any hotels or categories (minimum stars, hostels).
- Currency: confirm Hotelbeds contract currency once the test key is checked.
- Cancellation terms shown to guests for hotel bookings, and who bears Hotelbeds fees on late cancellations (default: the guest, per the hotel's policy).
- Whether guests can cancel from an account page in the first version or only by contacting you (default: contact you; admin cancels).
