import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';
import { readdirSync } from 'node:fs';

// @astrojs/sitemap only lists routes it can enumerate without running the
// app — a dynamic route like /guides/[slug] never appears automatically,
// same pre-existing gap as /tours/[slug]. Guides are static markdown files
// known at build time, so listing them here is cheap and correct; tours are
// D1-backed and would need a build-time DB query to fix the same way (not
// done here — flagged separately, out of scope for this change).
const guideSlugs = readdirSync(new URL('./src/content/guides/', import.meta.url))
  .filter((f) => f.endsWith('.md'))
  .map((f) => f.replace(/\.md$/, ''));

// Same gap, same fix, for backlog 2.7's /agra/[slug] attraction pages.
const attractionSlugs = readdirSync(new URL('./src/content/attractions/', import.meta.url))
  .filter((f) => f.endsWith('.md'))
  .map((f) => f.replace(/\.md$/, ''));

export default defineConfig({
  integrations: [
    tailwind(),
    react(),
    sitemap({
      customPages: [
        ...guideSlugs.map((slug) => `https://www.iwisglobal.com/guides/${slug}`),
        ...attractionSlugs.map((slug) => `https://www.iwisglobal.com/agra/${slug}`),
      ],
    }),
  ],
  site: 'https://www.iwisglobal.com',
  output: 'hybrid',
  adapter: cloudflare(),
});
