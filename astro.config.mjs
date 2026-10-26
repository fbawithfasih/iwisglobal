import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';
import { readdirSync, readFileSync } from 'node:fs';
import { LOCALIZED_STATIC, LOCALE_PREFIXES, localizedPath } from './src/lib/localizedPaths.mjs';

// @astrojs/sitemap only lists routes it can enumerate without running the
// app — a dynamic route like /guides/[slug] never appears automatically.
// Guides/attractions are static markdown files known at build time, so
// listing them here is a cheap readdirSync. Tours are D1-backed, so the
// same gap for /tours/[slug] needs a build-time DB query instead — see
// fetchTourSlugs below.
const guideSlugs = readdirSync(new URL('./src/content/guides/', import.meta.url))
  .filter((f) => f.endsWith('.md'))
  .map((f) => f.replace(/\.md$/, ''));

// Same gap, same fix, for backlog 2.7's /agra/[slug] attraction pages.
const attractionSlugs = readdirSync(new URL('./src/content/attractions/', import.meta.url))
  .filter((f) => f.endsWith('.md'))
  .map((f) => f.replace(/\.md$/, ''));

// account_id is not secret (it's routinely visible in dashboard URLs and
// API error messages, same non-secret status as wrangler.toml's
// database_id below) — only CLOUDFLARE_API_TOKEN is.
const CLOUDFLARE_ACCOUNT_ID = '498806a1eb9b0387d7a4d43cea283312';
const D1_DATABASE_ID = '71733870-0326-4760-b9f6-9c0513a7ce10';

// Published tour slugs, for the /tours/[slug] sitemap gap. Uses
// Cloudflare's D1 REST API directly rather than `wrangler d1 execute
// --remote` — this environment's wrangler login lacks D1 API scope (fails
// with a 7403 "not authorized" error), while CLOUDFLARE_API_TOKEN in .env
// already works against the same database (confirmed working for this
// change). A missing token, a network hiccup, or an API error means the
// sitemap omits tour URLs for that build (logged as an error, see
// fetchD1Slugs), not a broken build.
function readEnvVar(name) {
  // Deliberately not process.loadEnvFile: its parsing produced a token
  // value that the D1 API rejected (403) even though the identical raw
  // value, read this way, is confirmed working against the same endpoint.
  // A plain KEY=VALUE line read avoids whatever loadEnvFile was doing
  // differently (quoting/escaping) that corrupted the value.
  try {
    const raw = readFileSync(new URL('./.env', import.meta.url), 'utf8');
    const line = raw.split(/\r\n|\n/).find((l) => l.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim() : undefined;
  } catch {
    return undefined;
  }
}

// Runs one read-only query against D1 at build time, for the sitemap.
// Returns the rows, or null on any failure (logged, never silent, never
// fatal: a sitemap gap shouldn't block a deploy). "::error::" surfaces as an
// annotation on the GitHub Actions run.
async function queryD1(sql) {
  const fail = (reason) => {
    console.error(`::error::Sitemap D1 query failed (${sql}): ${reason}`);
    return null;
  };
  const token = readEnvVar('CLOUDFLARE_API_TOKEN');
  if (!token) return fail('CLOUDFLARE_API_TOKEN missing from .env');

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}/query`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql }),
      }
    );
    const json = await res.json().catch(() => null);
    if (!res.ok) return fail(`HTTP ${res.status} ${JSON.stringify(json?.errors ?? '')}`);
    return json?.result?.[0]?.results ?? [];
  } catch (err) {
    return fail(String(err));
  }
}

// Shared by tours and blog_posts — both are D1-backed with the same
// id/slug/status shape. Live sitemaps once shipped with zero tour/blog URLs
// unnoticed, so an empty result is reported too.
async function fetchD1Slugs(sql) {
  const rows = await queryD1(sql);
  if (!rows) return [];
  const slugs = rows.map((r) => r.slug).filter(Boolean);
  if (slugs.length === 0) console.error(`::error::Sitemap D1 slug query returned no published slugs (${sql})`);
  return slugs;
}

const tourSlugs = await fetchD1Slugs("SELECT slug FROM tours WHERE status = 'published'");
// /blog/[slug] posts are D1-backed too (schema_blog_posts.sql) — same gap,
// same fix as tours.
const blogSlugs = await fetchD1Slugs("SELECT slug FROM blog_posts WHERE status = 'published'");
// /reviews is indexable once a review is approved (it's noindex while empty),
// so it's in the sitemap only then. Checked at each build, like the slugs.
const reviewsRows = await queryD1("SELECT 1 AS found FROM tour_reviews WHERE status = 'approved' LIMIT 1");
const hasApprovedReviews = (reviewsRows?.length ?? 0) > 0;

export default defineConfig({
  integrations: [
    // Every layout (BaseLayout, AdminLayout, admin/login) already has its own
    // @tailwind directives; the default injected copy shipped the whole
    // stylesheet a second time (two ~54 KB render-blocking CSS files).
    tailwind({ applyBaseStyles: false }),
    react(),
    sitemap({
      // Only indexable pages: admin/account/auth are robots-disallowed or
      // redirect, and login/signup/booking-confirmation have no search value.
      // /review is a guest's private rating page; /reviews is listed only
      // once it has an approved review (see hasApprovedReviews).
      filter: (page) =>
        !/^https:\/\/www\.iwisglobal\.com\/(admin|account|auth|login|signup|forgot-password|reset-password|booking|review)(\/|$)/.test(page) &&
        (hasApprovedReviews || !/^https:\/\/www\.iwisglobal\.com\/((es|fr|de)\/)?reviews(\/|$)/.test(page)),
      // Match src/middleware.ts, which 301s trailing-slash paths to bare ones.
      serialize: (item) => ({ ...item, url: item.url.replace(/(?<=\.com\/.+)\/$/, '') }),
      // Every language version of every page: the English URL plus /es, /fr, /de.
      i18n: { defaultLocale: 'en', locales: { en: 'en', es: 'es', fr: 'fr', de: 'de' } },
      customPages: [
        ...guideSlugs.map((slug) => `/guides/${slug}`),
        ...attractionSlugs.map((slug) => `/agra/${slug}`),
        ...tourSlugs.map((slug) => `/tours/${slug}`),
        ...blogSlugs.map((slug) => `/blog/${slug}`),
        ...LOCALIZED_STATIC.filter((p) => hasApprovedReviews || p !== '/reviews'),
      ].flatMap((path) => {
        const out = LOCALE_PREFIXES.map((l) => `https://www.iwisglobal.com${localizedPath(path, l)}`);
        // Static pages are already listed in English by the integration.
        return LOCALIZED_STATIC.includes(path) ? out : [`https://www.iwisglobal.com${path}`, ...out];
      }),
    }),
  ],
  site: 'https://www.iwisglobal.com',
  output: 'static', // Astro 5: 'static' now behaves as 'hybrid' did (pages opt in to server rendering)
  // The site does not use Astro's image optimiser (images are served as-is from R2 or /public); passthrough keeps the
  // native image library (sharp) out of the Worker bundle, where it cannot run.
  adapter: cloudflare({ imageService: 'passthrough' }),
  // Astro's built-in cross-site form check refuses the one-click unsubscribe of Gmail, Yahoo and Apple Mail (they send no
  // Origin header). It is replaced by the same rule in src/middleware.ts with that single exemption: src/lib/originCheck.ts.
  security: { checkOrigin: false },
});
