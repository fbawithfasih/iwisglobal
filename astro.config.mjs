import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  integrations: [tailwind(), react(), sitemap()],
  site: 'https://www.iwisglobal.com',
  output: 'hybrid',
  adapter: cloudflare(),
});
