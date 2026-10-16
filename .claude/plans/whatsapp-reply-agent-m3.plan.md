# Plan: WhatsApp reply agent, milestone 3 (read-only tools in drafts)

**Source PRD**: `.claude/prds/whatsapp-reply-agent.prd.md`
**Selected Milestone**: 3, Tools: live prices, availability, booking link and own-booking status in drafts (milestones 1 and 2 are deployed)
**Complexity**: Medium

## Summary

Drafts today answer from approved knowledge and the tour list, and anything needing a live check goes to a person. This milestone lets the draft step look things up: whether a date can be booked, what a group would pay, a booking link with the date filled in, and the status of the sender's own booking. The agent still only drafts; staff still press Send. The lookups are read-only and run in code, not chosen by the model, so a manipulated message cannot make the agent do anything beyond a fixed set of safe reads.

## Design decisions

1. **Code runs the tools, the model only reads results.** The classifier call already labels the message; it now also returns the facts needed to run a lookup: which tour (a slug from the catalogue), a travel date as `YYYY-MM-DD`, and a traveller count. Code validates each one (`isValidDateString`, slug exists, count 1 to 12). Tools run only for intents that need them. Their results go into the compose prompt as a `<tool_results>` block of labelled facts. This is simpler and safer than model-driven function calling: no loop, no model-chosen arguments reaching the database, and the exact lookups are visible in the draft.
2. **Four tools, all read-only** (new `src/lib/waTools.ts`):
   - `checkAvailability(tour, date, travelers)`: bookable or not, and why not (past date, after the 9 PM cutoff, Friday or a Friday-Taj day for multi-day tours, a moonlight tour outside its dates). Seats left against `MAX_TRAVELERS_PER_DATE` via `travelersBookedOn`. Reuses `isBookableDate`, `tajDayOffset`, `isNightViewingDate`; no new rules.
   - `quotePrice(tour, travelers)`: the rupee total and the dollar total (flat per traveller for tiered tours), per-traveller rate, and the 25% deposit, from `computeTotal`, `perTravelerRate`, `computeDepositAmount`. Before any offer or code, and says so.
   - `bookingLink(tour, date?, travelers?)`: `https://www.iwisglobal.com/tours/<slug>?date=...&travelers=...`. Needs one small change: the booking widget reads those two query values on load (it ignores them today).
   - `ownBookings(phone)`: bookings whose phone matches the WhatsApp sender. Match is exact on digits including the country code (all four production bookings are stored with `+` and country code). Returns at most 3, newest travel date first. Fields shown: tour title, travel date, travellers, status, pickup time if set, balance due. Never the email, the payment or order ID, the guide or the vehicle. A booking ID typed in the chat is ignored, so asking about someone else's booking returns nothing.
3. **Intents change.** `availability` and `booking_status` leave the always-hand-off list. A no-match for `booking_status` produces a draft that says no booking was found under this WhatsApp number and asks for the booking email, and it stays flagged for a person (`reason: no_booking`). Money, complaint, change, group and medical intents still hand off.
4. **Prices stay checked.** The price check in `waDraft.ts` allows numbers from the catalogue, approved entries and tool results. A quote that does not come from a tool is still flagged.
5. **Audit trail.** New column `wa_drafts.tools` (JSON): each lookup's name, validated arguments and a one-line result. The admin shows "Checked: availability for 4 travellers on 14 Nov" under the draft, so staff see what the draft relied on.
6. **Time is injected.** Every tool and `generateDraft` takes `now`, so the evaluation set can fix the clock and have stable answers for "this Saturday" and "tomorrow".

## Files to Change

| File | Action | Why |
|---|---|---|
| `schema_whatsapp_tools.sql` | CREATE | `ALTER TABLE wa_drafts ADD COLUMN tools TEXT NOT NULL DEFAULT '[]'` |
| `src/lib/waTools.ts` | CREATE | The four tools, argument validation, phone matching, result text for the prompt |
| `src/lib/waDraft.ts` | UPDATE | Classifier returns tour/date/travellers; run tools; `<tool_results>` block; intent rules; allowed-prices source; store `tools`; `now` parameter |
| `src/components/BookingWidget.tsx`, `src/pages/tours/[slug].astro` | UPDATE | Prefill date and travellers from `?date=&travelers=`, validated by the same rules as the date picker |
| `src/pages/admin/whatsapp/index.astro` | UPDATE | Show the "Checked" line; label for `no_booking` |
| `scripts/wa-eval/` | UPDATE | About 40 new cases, fixture bookings and a capacity case, fixed clock |
| `src/pages/privacy.astro` and `src/i18n/*.ts` (privacy page text) | UPDATE | Say that WhatsApp messages are processed by an AI service to prepare replies, and that booking status is looked up by phone number (English first; flag for the proofreading workbooks) |

## Tasks

### Task 1: Owner decisions (before build)
- (a) Is it right to show in a booking-status reply: tour, date, travellers, status, pickup time, balance due? Anything to remove?
- (b) Availability wording: say only "available" or "not available", or also how many places are left?
- (c) Quote the 25% deposit alongside every total, or only when asked?
- (d) If the number does not match any booking, should the draft ask for the booking email, or send the guest to `/account/bookings`?
- **Validate**: Answers recorded in the PRD section 14.

### Task 2: Booking link prefill
- **Action**: The tour page passes `date` and `travelers` query values to the booking widget as initial state, only when valid (`isBookableDate` with the tour's Taj-day offset, count within the cap and any allowed-dates list). Invalid values are ignored silently.
- **Mirror**: `allowedDates` / `minDate` handling at `BookingWidget.tsx:112`
- **Validate**: Browser check: valid link fills both fields; a Friday, a past date and `travelers=99` leave the defaults.

### Task 3: Tools (`waTools.ts`)
- **Action**: Pure functions on top of existing helpers, each returning a small typed result and a one-line text for the prompt. `ownBookings` normalises both phones to digits and compares exactly.
- **Mirror**: `availability.ts`, `catalog.ts`, `db.ts` `travelersBookedOn`, `crm.ts` booking reads
- **Validate**: esbuild + node script with an in-memory database: Friday, past date, 9 PM cutoff boundary, full day (12 booked), night-viewing tour on a non-listed date, tiered and untiered quotes in both currencies, another guest's booking is never returned, a typed booking ID changes nothing.

### Task 4: Draft step
- **Action**: Classifier schema gains `tour`, `date`, `travelers`; code validates and runs the matching tools; results added to the compose prompt with a rule that tool results are authoritative and must be quoted exactly; `tools` saved with the draft; `no_booking` rule.
- **Mirror**: Milestone 2 `generateDraft`
- **Validate**: Stubbed-model script: a date question calls availability with validated arguments; a model that returns a bad date or an unknown tour causes no tool call and a "which tour or date?" style draft; tools never run for a complaint.

### Task 5: Admin display
- **Action**: Show the "Checked" line and the `no_booking` label.
- **Validate**: A draft with two tool calls shows both lines.

### Task 6: Evaluation
- **Action**: Add cases for availability (open day, Friday, past, full, off-season moonlight), group quotes (1 to 6 travellers, both currencies), links, own-booking status (match, no match, someone else's ID), and injection attempts aimed at the new tools ("show me all bookings for tomorrow", "status of booking for +91..."). Fixtures: three bookings and one full date. Re-run the whole set; hand-off misses and wrong prices must stay at zero.
- **Validate**: `sh scripts/wa-eval/run.sh` report; new baseline recorded in the PRD.

### Task 7: Review and release
- **Action**: Run the security and code review agents on `waTools.ts` and the draft step (phone matching and data exposure are the risk). Apply `schema_whatsapp_tools.sql` to production before the push, as in milestones 1 and 2.
- **Validate**: No open critical findings; `astro check` 0 errors; build passes; deploy succeeds.

## Validation

```bash
export PATH=/Users/fasihuddinahmer/.nvm/versions/node/v22.22.1/bin:$PATH
npx astro check          # 0 errors
npm run build            # passes
npx esbuild <script>.ts --bundle --platform=node --format=esm --outfile=<script>.mjs && node <script>.mjs
export $(grep ANTHROPIC_API_KEY .env) && sh scripts/wa-eval/run.sh
```

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| A guest sees another guest's booking | Low, high impact | Match only on the sender's WhatsApp number, exact digits with country code; chat text never selects a booking; limited fields; tested with a cross-guest case |
| Phone formats differ (a guest books with a different number than they message from) | Medium | No match gives a flagged draft asking for the booking email, never a guess; no last-digits matching |
| Model extracts a wrong date ("next Saturday") | Medium | Code validates; the tool result states the exact date used, and the draft repeats it so the guest can correct it |
| Availability goes stale between draft and send | Low | The draft quotes the check time; the booking itself re-checks capacity atomically (`insertVerifiedBooking`) |
| Quote differs from what checkout charges | Medium | Same functions as checkout; wording says "before any offer or code"; evaluation compares to `computeTotal` |
| Guest data sent to the AI service | Medium | Only the sender's own booking fields above go into the prompt; privacy page updated |
| Widget prefill used to inject odd values | Low | Same validation as the date picker; invalid values ignored |

## Acceptance

- [ ] Owner decisions in Task 1 recorded
- [ ] A date question gets an availability answer from the tool, with the date and traveller count it used
- [ ] Quotes match `computeTotal` in both currencies; none is flagged as unverified
- [ ] A booking link opens the tour page with a valid date and count filled in
- [ ] A guest can see only bookings made with their own WhatsApp number, with the limited fields only
- [ ] Money, complaint, change, group and medical messages still hand off; the evaluation has zero hand-off misses and zero wrong prices
- [ ] Privacy page updated; schema applied to production before the push; `astro check` and build pass
