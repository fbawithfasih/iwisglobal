# AI search audit against Google's guide (28 October 2026)

Checked against Google Search Central's "Optimizing your website for generative AI features on Google Search". Data: Search Console for
`sc-domain:iwisglobal.com`, 28 Sep to 25 Oct 2026, plus the live pages and sitemap.

## Already in line with the guide
- Crawlable and indexable: `robots.txt` allows everything except admin, api, account and `/r/`; canonical on every page; the `?lang=` and
  `?currency=` variants are `noindex, follow`.
- Sitemap: 205 URLs, English plus es/fr/de with hreflang alternates, no private pages.
- Structured data where it applies (Organization/TravelAgency, WebSite on the home page, Product and TouristTrip on tours, Article on
  posts and guides, FAQPage on help and guides, BreadcrumbList). The guide says none of it is required for AI features.
- Content: posts carry first-hand detail ("on our own tours, a 5:30 AM pickup reaches Agra around 8:30"), dates, sources and links to tours.
- Images have alt text (the 13 empty alts on the home page are the decorative hero thumbnails).
- Nothing built "just for AI": no scaled fan-out pages, no chunking. `llms.txt` exists; the guide says Google ignores it (harmless).

## Changed in this PR
- The sitemap had no `<lastmod>`. It now has one wherever the site has a real date: blog posts and tours from `updated_at`, guides and
  attractions from their `dateModified`, list pages from their newest entry; translations share the English page's date. Pages without a
  real date (home, policies) get none. Helper and test: `src/lib/sitemapLastmod.mjs`, `scripts/contacts-test/sitemap-lastmod.ts`.

## What the data says
- Search Console shows 134 pages with impressions but very few clicks. Impressions sit on informational posts (Diwali 433, Delhi to Agra
  time 350, Shah Jahan 297, Gatimaan timetable 240, train 245); the tour pages that earn money rank at positions 35 to 70.
- Click-through on those posts is 0.3 to 1.2 percent even at positions 6 to 9, which is what an AI answer above the results does.
  This is a content and authority gap, not a markup gap, and markup tweaks will not close it.

## Owner actions (cannot be done from code)
1. Search Console: open the Generative AI performance report and confirm the site is included in generative AI features.
2. Google Business Profile for IWIS Global (Agra): verify it, add hours, the website link, the WhatsApp number, photos and ask guests for reviews.
3. Reviews: genuine reviews on the tours (the site lists `/reviews` only once one is approved) and on Google and TripAdvisor.
4. Named authors: posts and guides are credited to "IWIS Global". A real guide's name and credentials would be a stronger signal; never an
   invented person.
5. Tour pages: they need what the posts have (first-hand detail, a photo set, a "who this is for", real itinerary times) to compete.
6. New or edited posts reach the sitemap only on the next deploy. Option: a nightly redeploy from GitHub Actions.
7. Not measured here: Core Web Vitals (the public PageSpeed API was rate-limited). Check the Core Web Vitals report in Search Console.
