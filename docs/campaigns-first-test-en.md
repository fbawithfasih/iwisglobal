# First test campaign (English draft)

Status: draft written 27 Oct 2026 for the owner to read and change. Nothing here has been entered in the campaign tool or sent. Facts were taken from the live tour page `https://www.iwisglobal.com/tours/taj-mahal-sunrise-tour` on 27 Oct 2026; re-read it before sending, because the page, not this file, is the source of truth.

## Purpose

A plain, honest first email to **your own subscribed addresses only**, to prove the whole path works (domain, headers, unsubscribe, clicks, layout on a phone) before any real audience. It promotes one tour, with no discount and no pressure.

## Fields to paste into Campaigns, New campaign, English tab

| Field | Text |
|---|---|
| Campaign name (internal) | First test, English |
| Subject (recommended) | Sunrise at the Taj Mahal, with your own guide and car |
| Preview line | Private guide, private car, hotel pickup in Delhi. Free cancellation up to 24 hours before. |
| Headline | The Taj Mahal at sunrise, with a private guide |
| Intro | The Taj Mahal opens 30 minutes before sunrise, and that first hour is different: softer light and far fewer people than by mid-morning. Our private sunrise tour from Delhi is built around that window. |
| Paragraph 1 | **What you get.** A private guide who tells the story and shows you where to stand for the classic sunrise photos, skip-the-line entry support, and a private air-conditioned car with driver from any hotel or the airport in Delhi. Bottled water, parking, fuel and tolls are included. |
| Paragraph 2 | **Good to know.** The Taj Mahal is closed on Fridays, so this tour does not run that day. Sunrise moves through the year (as late as 7:10 AM in January, over an hour earlier by June), so we set your pickup time for your travel date. Entry tickets are not included by default: add them when you book, or buy them at the gate. |
| Paragraph 3 | **Book with confidence.** Confirmation is instant, and cancellation is free up to 24 hours before your tour. Questions first? Write to info@iwisglobal.com or message us on WhatsApp. We usually reply within a few hours. |
| Tour to show | `taj-mahal-sunrise-tour` (the card shows the tour's title, photo and its current "from" price; no price is typed into the text on purpose, so it can never go out of date) |
| Button text | See the sunrise tour |
| Button link | https://www.iwisglobal.com/tours/taj-mahal-sunrise-tour |

The tool adds the legal footer by itself (IWIS Global, the Agra address, why the person is receiving it, the unsubscribe link, the privacy link) and tags the button with `utm_source=email&utm_medium=newsletter` and the campaign id, so a click can be traced in Google Analytics.

Other subject lines, if you prefer: "A quieter Taj Mahal: our private sunrise tour from Delhi" or "Seeing the Taj Mahal at sunrise: what the morning is really like". All three describe the email truthfully (no false urgency, no "Re:", no claim that is not on the tour page).

## Where each claim comes from (tour page, 27 Oct 2026)

| Claim | Page says |
|---|---|
| Opens 30 minutes before sunrise | "The monument opens 30 minutes before sunrise" |
| Softer light, far fewer people than mid-morning | "cooler, softer light and far fewer people than by 10 or 11 AM" |
| Private guide, storytelling, photo spots | "Private guide with storytelling & photo assistance" |
| Skip-the-line entry support | Listed under Highlights |
| Private AC car with driver, hotel or airport pickup | "Pickup & drop-off from any hotel or Airport in Delhi"; "Private AC car with driver" |
| Water, parking, fuel, tolls included | "Bottled water, parking, fuel, and tolls are included" |
| Closed Fridays | "The Taj Mahal is closed every Friday — this tour can't run on a Friday" |
| Sunrise as late as 7:10 AM in January, over an hour earlier by June | Same sentence on the page |
| Pickup time set for the travel date | "your exact pickup time is set for your travel date" |
| Tickets not included by default; add or buy at the gate | "Entry tickets ... aren't included by default — add them when booking, or buy them yourself at the gate" |
| Instant confirmation; free cancellation up to 24 h | "Confirmation Instant, on booking"; "Cancellation Free up to 24h before" |
| Reply usually within a few hours | "We reply by WhatsApp or email, usually within a few hours" |

## Please check before using it

1. **Skip-the-line entry support** and **"usually within a few hours"** are things only you can vouch for. Remove either if it is not true on a normal day.
2. **Free cancellation up to 24 hours** must match your Cancellation & Refund Policy page exactly.
3. The email says nothing about discounts or deadlines. If you add one, it must be real and dated.
4. German readers: this is advertising, and the subject and sender say so honestly. Keep it that way in later campaigns (no pretending to be a booking confirmation).

## How to use it (after the Resend and DNS setup)

1. Admin, Campaigns, "New campaign", name it, paste the fields above, save.
2. Audience: restrict to your own subscribed addresses (a tag or country filter). The count must be exactly the number of your own addresses.
3. **Send test** to up to five of your own addresses (Gmail, Outlook, a German provider). Test mails are marked `[TEST]` and are not counted.
4. In Gmail, "Show original": SPF, DKIM and DMARC pass; `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` present. Click Gmail's own Unsubscribe and the page's link once each.
5. Check it on a phone: card photo, button size, footer readable, no spam-folder landing.
6. Only then tick "I have read and approve this" for English. A real send also needs `MARKETING_SENDING_ENABLED=1`, which stays off until you decide.

Other languages: the tool's "Translate" button drafts German, French and Spanish with Claude and saves them unreviewed. Do not send a language you have not read.
