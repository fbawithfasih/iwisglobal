# Germany push: what is ready and what you do next

Plan: `/root/.claude/plans/spicy-noodling-stroustrup.md` (12 weeks from 29 Oct 2026). Budget: about 300 euro a month, Google Search only. Native German reader: yours.

## Ready in this repo
| What | File | Your step |
|---|---|---|
| Impressum page, linked in every footer | `/impressum`, `/de/impressum` | Have the lawyer confirm the wording (with the privacy review) |
| German texts for proofreading, 551 lines of the customer journey | `docs/german-review/de-round-1.csv` | Open in Google Sheets, your reader fills column D (corrected text, or OK), keeps HTML tags unchanged, sends it back; I apply it in one pull request |
| German Google Ads campaign | `docs/google-ads/iwis-de-keywords.csv`, `iwis-de-ads.csv` | Google Ads, Tools, Bulk actions, Uploads: import keywords first, then ads. Campaign "Search - DE - Taj Mahal": set Germany, language German, Search network only, 10 euro a day, manual CPC with a cap from the Keyword Planner |

## Held back until you confirm (these claims are not in the ad file yet)
1. "Deutschsprachiger Guide" and "Auf Wunsch mit deutschsprachigem Guide": confirm you offer a German-speaking guide on the standard tours and at what price.
2. "Kostenlos stornieren bis 24h" and "Kostenlos stornieren bis 24 Stunden vor der Abholung": confirm this is the policy (it is in the English ads already).
When confirmed, add these to the ads: headlines `Deutschsprachiger Guide` (23) and `Kostenlos stornieren bis 24h` (28); descriptions `Online buchen, sofort bestätigt. Kostenlos stornieren bis 24 Stunden vor der Abholung.` (86) and `Abholung am Hotel in Delhi. Auf Wunsch mit deutschsprachigem Guide. Jetzt Termin sichern.` (89).

## Week 1 checklist
- [ ] Answer the two confirmations above.
- [ ] Send me the second German guest (only Jan Hendrik Petersen is clearly German in the data).
- [ ] Proofread round 1 (the sheet above).
- [ ] Google Ads, Keyword Planner, Germany, German: read volume and CPC for the keywords in `iwis-de-keywords.csv` and send them to me.
- [ ] GA4, Admin, Data streams, Configure tag settings, List unwanted referrals: add `razorpay.com` and `api.razorpay.com` so purchases keep their source.
- [ ] Google Ads, Goals: import the GA4 purchase and lead events as conversions.

## Do not
Run the campaign before the German pages are proofread; add Austria and Switzerland before week 6; buy links or post in forums as an ad.
