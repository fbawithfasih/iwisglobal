import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';
import { readdirSync, readFileSync } from 'node:fs';

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

// Shared by tours and blog_posts — both are D1-backed with the same
// id/slug/status shape, so one query-runner covers both sitemap gaps.
async function fetchD1Slugs(sql) {
  // Still non-fatal (a sitemap gap shouldn't block a deploy), but never
  // silent: live sitemaps shipped with zero tour/blog URLs unnoticed.
  // "::error::" surfaces as an annotation on the GitHub Actions run.
  const fail = (reason) => {
    console.error(`::error::Sitemap D1 slug query failed (${sql}): ${reason}`);
    return [];
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
    const rows = json?.result?.[0]?.results ?? [];
    const slugs = rows.map((r) => r.slug).filter(Boolean);
    if (slugs.length === 0) return fail('query returned no published slugs');
    return slugs;
  } catch (err) {
    return fail(String(err));
  }
}

const tourSlugs = await fetchD1Slugs("SELECT slug FROM tours WHERE status = 'published'");
// /blog/[slug] posts are D1-backed too (schema_blog_posts.sql) — same gap,
// same fix as tours.
const blogSlugs = await fetchD1Slugs("SELECT slug FROM blog_posts WHERE status = 'published'");

export default defineConfig({
  integrations: [
    tailwind(),
    react(),
    sitemap({
      // Only indexable pages: admin/account/auth are robots-disallowed or
      // redirect, and login/signup/booking-confirmation have no search value.
      // /reviews is noindex until there are real reviews to show on it.
      filter: (page) =>
        !/^https:\/\/www\.iwisglobal\.com\/(admin|account|auth|login|signup|booking|reviews)(\/|$)/.test(page),
      // Match src/middleware.ts, which 301s trailing-slash paths to bare ones.
      serialize: (item) => ({ ...item, url: item.url.replace(/(?<=\.com\/.+)\/$/, '') }),
      customPages: [
        ...guideSlugs.map((slug) => `https://www.iwisglobal.com/guides/${slug}`),
        ...attractionSlugs.map((slug) => `https://www.iwisglobal.com/agra/${slug}`),
        ...tourSlugs.map((slug) => `https://www.iwisglobal.com/tours/${slug}`),
        ...blogSlugs.map((slug) => `https://www.iwisglobal.com/blog/${slug}`),
      ],
    }),
  ],
  site: 'https://www.iwisglobal.com',
  output: 'hybrid',
  adapter: cloudflare(),
});
