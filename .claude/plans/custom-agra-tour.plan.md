# Plan: Customise your Agra tour (phase 1)

**Complexity:** Large (four milestones)
**Scope:** Agra only. Golden Triangle is phase 2.

## Summary

A guest builds their own Agra trip on one page: dates and group size, one or more days, each day started from a ready-made tour or built from a stop list, a vehicle type, and a hotel choice. The server prices the trip from a rate table the owner maintains, and the guest pays a deposit online. The booking then waits for the owner to confirm it, and is refunded in full if the owner cannot supply it. Everything the guest types is re-validated and re-priced on the server; the browser total is a preview only.

## Decisions (made with the owner)

| Question | Decision |
|---|---|
| What happens on submit | Instant firm price, pay online (deposit) |
| Vehicle pricing | A day rate per vehicle type, replacing the per-person price |
| Vehicle types | Sedan (3 seats), SUV or MUV (6), Tempo Traveller (12), Luxury car (Mercedes or BMW) |
| Hotels | Guest picks from the 10-hotel list, or "I have my own", or "please arrange a stay". Stays are quoted and confirmed separately by the team, not charged online |
| After payment | Deposit paid, status "needs confirmation", owner confirms; full refund if not supplied |
| Prices | The owner enters them in admin after the build; the page stays hidden until set |
| Ready-made tours inside the builder | A template that pre-fills stops; the day is priced by vehicle plus guide |
| Entry tickets | Included in the price, at the official fee for each traveller's category |
| Delhi start | A separate Delhi round-trip rate per vehicle |
| Itinerary | Pick stops from a list, with a time of day for each |

## Price rule (server-side, one pure function)

For each trip:

- **Vehicle:** each day costs the chosen vehicle's Agra day rate. A same-day trip that starts in Delhi, Gurgaon, Noida or the airport costs its Delhi round-trip rate instead. For a longer stay that starts in Delhi, the Delhi round-trip rate is charged once and the other days use the Agra day rate.
- **Guide:** one guide day rate for each sightseeing day.
- **Tickets:** for each stop, the fee for each adult's category (Foreign, Indian, SAARC/BIMSTEC), using the Friday fee or the after-the-Taj fee where one applies. Children under 15 are free. Fees come from an admin-editable table, seeded from the five attraction pages, with a "checked on" date shown.
- **Total** is the sum. The **deposit** reuses the rule your tours use.
- **Currency:** rupees or dollars. Vehicle and guide rates are entered in both, as for tours. Ticket fees are rupees, converted at the site's existing rate.

## Data (additive, one schema file: `schema_custom_trips.sql`)

| Table | Holds |
|---|---|
| `custom_vehicles` | name, seats, Agra day rate and Delhi round-trip rate (rupees and dollars), active, sort |
| `custom_settings` | guide day rate (both currencies), maximum days, the on/off switch (default off) |
| `custom_stops` | name, linked attraction page, typical visit minutes, closed on Fridays, best time window, active, sort |
| `custom_stop_fees` | stop, traveller category, fee, Friday fee, after-Taj fee, checked on |
| `custom_trips` | the guest's selections and the priced breakdown as stored JSON, status (quoted, deposit paid, confirmed, cancelled), Razorpay order id, contact details |

The final booking is also written to the existing `bookings` table (source "custom") so the admin booking page, tickets-to-buy list, notes and emails keep working.

## Server rules (checked again at order time)

- Start date no earlier than the existing bookable-date rule; every day must be valid.
- Taj Mahal stops are rejected on Fridays. Night-viewing stops only on the ASI night-viewing nights.
- A day may hold only as many stops as fit in a realistic day (stop minutes plus a travel buffer).
- Group size must fit the vehicle's seats. Above 12, the page asks the guest to contact you.
- Maximum number of days is a setting (default 7).
- The browser's total is ignored. The server recomputes from the saved rates and stores the breakdown it charged against.

## Endpoints

- `POST /api/custom-trip/quote`: validates and returns the breakdown. Writes nothing.
- `POST /api/custom-trip/order`: re-validates, recomputes, saves a `custom_trips` row, and creates the Razorpay deposit order with the trip id in its notes.
- `verify-payment`: when the order's notes name a custom trip, verify the signature, mark the deposit paid once (safe to call twice), write the booking, and send the guest and staff emails.

## Pages and components

- `src/pages/customize-your-tour.astro` and `src/components/TourCustomizer.tsx`: five steps (Trip, Itinerary, Vehicle, Hotel, Review and pay) with a live summary, a sticky summary bar on phones, keyboard friendly, reduced motion respected.
- `src/lib/customTrip.ts`: types, validation and the price function, used by both the browser preview and the server.
- Hotels from the existing `AGRA_HOTELS` list. Dictionary keys in all four languages. Links from the tours page, tour pages and the homepage.
- Admin: `/admin/custom-trips` for vehicles, rates, stops, fees and the on/off switch; a list of custom trips with Confirm and Cancel; tickets-to-buy lines for custom bookings.

## Milestones

| # | Milestone | Done when |
|---|---|---|
| M1 | Data, price function, admin settings; page hidden | Price function passes its tests; you can enter vehicles, rates, stops and fees in admin |
| M2 | The builder page with a live estimate, no payment yet | A guest can build a trip and see a price on phone and desktop in four languages, behind the switch |
| M3 | Payment, booking, emails, admin confirm and cancel | A test-mode deposit creates a "needs confirmation" booking with the right itinerary, tickets and emails; double verification is safe |
| M4 | Launch | You enter real prices, the hotel "arrange a stay" request reaches staff, cross-links and analytics are in, the switch is turned on |

## Tests (same approach as the WhatsApp agent: scripted, no new framework)

Price function (Agra start, Delhi same-day, Delhi multi-day, Friday and after-Taj ticket variants, child free), every validation rule, the order endpoint ignoring a tampered browser total, verify-payment idempotency, and the admin settings.

## Risks

| Risk | Mitigation |
|---|---|
| Official ticket fees change | Admin-editable table with a visible "checked on" date; a weekly reminder in the runbook |
| A wrong rate undercharges | Server-side only, a preview you can sanity-check in admin, switch off by default |
| Demand you cannot supply | Deposit and manual confirmation, with a full refund |
| Hotel prices are not firm | Not charged online; the team quotes and confirms |
| Rates include or exclude GST | Open item below |

## Open items for the owner (settle in M1, before the page is turned on)

1. Extra stops beyond the five on the site (for example Akbar's Tomb at Sikandra, a marble inlay workshop).
2. Are your vehicle and guide rates GST-inclusive final prices?
3. Children under 15 free at every stop? (The Agra Fort page says so; the Taj Mahal needs checking.)
4. Any peak-season supplement, and a maximum days default of 7?
5. Which refund and cancellation terms apply to custom trips?
6. Should the WhatsApp agent link this page for group and custom requests, which it now hands to a person?

## Acceptance

- [ ] A guest can build, price and pay a deposit for an Agra trip in all four languages.
- [ ] The price charged is always the server's price.
- [ ] Friday, night-viewing, capacity and day-length rules are enforced on the server.
- [ ] Staff see the full itinerary, vehicle, hotel request and tickets to buy.
- [ ] Nothing is visible to guests until the owner switches it on.
