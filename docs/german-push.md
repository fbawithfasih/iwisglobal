# Germany push: what is ready and what you do next

Plan: `/root/.claude/plans/spicy-noodling-stroustrup.md` (12 weeks from 29 Oct 2026). Budget: about 300 euro a month, Google Search only. Native German reader: yours.

## Ready in this repo
| What | File | Your step |
|---|---|---|
| Impressum page, linked in every footer | `/impressum`, `/de/impressum` | Have the lawyer confirm the wording (with the privacy review) |
| German texts for proofreading, 551 lines of the customer journey | `docs/german-review/de-round-1.csv` | Open in Google Sheets, your reader fills column D (corrected text, or OK), keeps HTML tags unchanged, sends it back; I apply it in one pull request |
| German Google Ads campaign | `docs/google-ads/iwis-de-keywords.csv`, `iwis-de-ads.csv` | Google Ads, Tools, Bulk actions, Uploads: import keywords first, then ads. Campaign "Search - DE - Taj Mahal": set Germany, language German, Search network only, 10 euro a day, manual CPC with a cap from the Keyword Planner |

## Confirmed on 29 Oct 2026 (now in the ad file)
- German-speaking guide on the standard tours: yes, for an additional 1,500 INR. Ad lines added: headline `Deutschsprachiger Guide` (23) and description `Abholung am Hotel in Delhi. Auf Wunsch mit deutschsprachigem Guide. Jetzt Termin sichern.` (89). The price is not in the ads; the tour pages should say it too (see "To do on the site").
- "Free cancellation up to 24h" is the real policy. Ad lines added: headline `Kostenlos stornieren bis 24h` (28) and description `Online buchen, sofort bestätigt. Kostenlos stornieren bis 24 Stunden vor der Abholung.` (86).
- Every ad now has 15 headlines and 4 descriptions, all within the 30 and 90 character limits.

## The two German guests (confirmed by the owner, 29 Oct 2026)
- Jan Hendrik Petersen: private offer paid in euro (250), travels 16 Nov 2026.
- Dzemal Elezagic: same-day Agra tour paid in rupees (20,397 INR), travelled 29 Oct 2026. A German guest paying in INR is a data point for the euro-pricing decision (plan step A6).
Both go on the "ask for a Google and Tripadvisor review" list; Elezagic is ready from 30 Oct.

## Decisions
- **No proofreading before launch** (owner's call). Risk: the German pages are machine translated. Keep `docs/german-review/de-round-1.csv`; when a German reader is available, send it back and the corrections go in one pull request. Until then, watch the Germany enquiries for confusion.
- **No Keyword Planner numbers** (owner could not fetch them). Start with manual CPC and a cap of 1.00 euro per click, 10 euro a day. This is a guess, not data. After the first 100 clicks, use the real average CPC in the Google Ads campaign view to move the cap.

## Set up in Google Ads (about 30 minutes)
1. Google Ads, Campaigns, New campaign, goal "Website traffic" (switch to conversions later), type Search, no Display, no Search Partners.
2. Name "Search - DE - Taj Mahal". Locations: Germany only, option "Presence: people in or regularly in your targeted locations". Language: German. Budget 10 euro a day. Bidding: Manual CPC, max CPC 1.00 euro.
3. Tools, Bulk actions, Uploads: upload `iwis-de-keywords.csv`, then `iwis-de-ads.csv`. Check the preview for errors before applying.
4. Keep the campaign paused until the GA4 steps below are done and a test purchase shows its source.

## GA4 (property 555159643)
1. Admin, Data streams, the web stream, Configure tag settings, Show more, **List unwanted referrals**.
2. Add rule "Referral domain contains" `razorpay.com`, and another for `api.razorpay.com`. Save.
3. Test: make a small test payment from a campaign-style link (`?utm_source=google&utm_medium=cpc&utm_campaign=de-tagestour`) and watch Reports, Realtime. The purchase should show source google / cpc, not "(direct) / (none)" or Razorpay.

## Google Ads conversions from GA4
1. Link GA4 to Google Ads first: GA4 Admin, Product links, Google Ads links, Link.
2. In GA4 Admin, Events, mark `purchase` and `generate_lead` as key events if they are not yet.
3. Google Ads, Goals, Conversions, New conversion action, Import, Google Analytics 4 web, pick `purchase` and `generate_lead`. Make `purchase` Primary and `generate_lead` Secondary.
4. Wait up to 24 hours; the status should change to "Recording conversions".

## To do on the site (not built yet)
- Done: tour pages now say "German-speaking guide available: ₹1,500 extra. Message us when you book." (in all four languages, under the key facts). Assumed to be per booking; the guest asks by message, there is no checkout option for it yet.
- Tag the German guests. There is no tag field on bookings yet; for now use a note on the lead.

## Do not
add Austria and Switzerland before week 6; buy links or post in forums as an ad.
