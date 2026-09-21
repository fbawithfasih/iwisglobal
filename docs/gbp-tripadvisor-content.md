# GBP + TripAdvisor content — ready to paste

Backlog 1.3, 1.4, 1.5. These are manual actions in Google Business Profile's
and TripAdvisor's own dashboards — no API integration exists for either, so
this is content for you to paste in yourself. Everything below is sourced
from content already live on the site (mainly `/help`), not invented.

---

## 1.3 — GBP Q&A section

GBP lets the business owner post both the question and the answer. Post
these as separate Q&A pairs (Google surfaces these in search/Maps, and most
operators leave this section empty — an easy win).

**Q: How do I book a tour?**
A: Choose a tour, pick your travel date and number of travelers, and pay
securely online at iwisglobal.com. You'll get instant confirmation by email
as soon as your payment goes through — no waiting for a callback.

**Q: Can I book a same-day tour?**
A: Yes — same-day booking is open until 9 PM IST the night before. After
that cutoff, the earliest available date is the next day, since same-day
pickups need early-morning coordination with the vehicle and guide.

**Q: Do I need to create an account to book?**
A: No account or sign-up needed. You just enter your name, email, and phone
number at checkout.

**Q: What payment methods and currencies do you accept?**
A: Payments are processed securely through Razorpay. Most tours can be paid
in Indian Rupees (INR); tours with a US Dollar price also let you pay in
USD.

**Q: Is payment on your site secure?**
A: Yes. Card and payment details are handled entirely by Razorpay — we
never see or store them — and every payment is cryptographically verified
before a booking is confirmed.

**Q: Are there any hidden fees?**
A: No. The price shown on the tour page, including any add-ons you select,
is exactly what you pay.

**Q: What's your cancellation policy?**
A: Free cancellation up to 24 hours before your tour starts.

**Q: What's included in the tour price?**
A: Each tour page lists exactly what's included and excluded — private
transport, guide, and entry tickets typically vary by tour. Check the
"Includes" and "Not included" sections on the specific tour before booking.

**Q: How do I contact you with a question?**
A: The fastest way is WhatsApp — message us at +91 6399226633. You can also
email info@iwisglobal.com.

---

## 1.4 — GBP profile setup checklist

- [ ] **Booking link**: `https://www.iwisglobal.com` (or link directly to
      `/tours` if GBP's booking-link field prefers a listing page)
- [ ] **Service areas**: Agra, Uttar Pradesh; pickup service extends to New
      Delhi and Delhi Airport (per the site's own tour descriptions —
      "Delhi Airport or New Delhi hotels")
- [ ] **Category**: verify it's set to something like "Tour operator" or
      "Travel agency" — not a generic category, since entity disambiguation
      already matters a lot for this brand name (see below)
- [ ] **Business name**: keep it exactly "IWIS Global" in the GBP name
      field (GBP doesn't allow keyword-stuffing the name field itself), but
      make sure the **description** field pairs it with the category —
      "IWIS Global, a Taj Mahal and Agra tour operator based in Agra,
      India" — for the same brand-collision reason as the site's schema
      markup (a German industrial chain and an Amazon storefront share the
      bare name)
- [ ] **Hours**: `TODO(fasih)` — not documented anywhere in this repo or
      the marketing context file. Add your actual operating hours (when
      someone can reach you / when bookings are processed), not the Taj
      Mahal's own visiting hours — those are two different things.
- [ ] **Photos**: `public/hero-taj-mahal.jpg` and any tour photos already
      uploaded via `/admin/tours` are usable — download them from the live
      site and upload natively to GBP (GBP doesn't accept hotlinked URLs)
- [ ] **Website field**: `https://www.iwisglobal.com`

---

## 1.5 — TripAdvisor operator listing copy

**Business name:** IWIS Global — pair with category in the listing
description for the same disambiguation reason as above.

**Category:** Tour operator / Day trip provider (Agra / Taj Mahal)

**Short description** (for listing summary fields):
> IWIS Global is a private, Agra-based Taj Mahal and Agra tour operator.
> We run same-day and sunrise trips from Delhi with private, air-
> conditioned transport and an English-speaking guide — booked online,
> guided in person, with no commission taken on any workshop or craft
> stop along the way.

**Longer description** (for the main listing body):
> IWIS Global runs private Taj Mahal and Agra tours for international
> travelers based in Delhi. Tours are booked directly online with instant
> confirmation and free cancellation up to 24 hours before departure —
> no phone tag, no waiting for a callback.
>
> We're a named, Agra-based operator, not a reseller. Every tour includes
> private air-conditioned transport and an English-speaking guide. If a
> tour's itinerary includes an optional craft or workshop stop, we take no
> commission from it — see our [no-commission
> pledge](https://www.iwisglobal.com/no-commission-pledge).

**Contact:** WhatsApp +91 6399226633, email info@iwisglobal.com, website
https://www.iwisglobal.com

**What NOT to put in this listing:** star ratings, review counts, or "X
happy customers" — there's no review history yet anywhere. TripAdvisor
builds its own rating from reviews submitted through the platform; don't
pre-empt it with a claim.
