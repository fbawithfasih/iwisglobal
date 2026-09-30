// Backlog 2.2 — llms.txt (llmstxt.org): a plain-text overview for AI
// systems/agents, listing what the site is and its key pages. Built as a
// dynamic route (not a static public/ file, unlike robots.txt) so it pulls
// live tour data from D1 and the real content-collection entries, rather
// than a snapshot that drifts out of sync as tours/prices/guides change —
// same reasoning as the AI Guide's system prompt pulling live catalog data.
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { listTours } from '../lib/tours';
import { resolveEnv } from '../lib/env';
import { edgeCached } from '../lib/edgeCache';

export const prerender = false;

const SITE = 'https://www.iwisglobal.com';

const build = async (locals: unknown): Promise<Response> => {
  const env = resolveEnv(locals);
  const tours = env.DB ? await listTours(env.DB, { status: 'published' }) : [];
  const guides = await getCollection('guides');
  const attractions = await getCollection('attractions');

  const lines: string[] = [];
  lines.push('# IWIS Global');
  lines.push('');
  lines.push(
    '> Private Taj Mahal & Agra tour operator based in Agra, India. Private same-day trips from Delhi, booked and paid for online, with transparent pricing and no hidden commissions.'
  );
  lines.push('');

  if (tours.length > 0) {
    lines.push('## Tours');
    for (const tour of tours) {
      lines.push(`- [${tour.title}](${SITE}/tours/${tour.slug}): ${tour.amount} ${tour.currency} per traveler, ${tour.durationLabel}. ${tour.summary}`);
    }
    lines.push('');
  }

  if (guides.length > 0) {
    lines.push('## Guides');
    for (const guide of guides) {
      lines.push(`- [${guide.data.title}](${SITE}/guides/${guide.slug}): ${guide.data.description}`);
    }
    lines.push('');
  }

  if (attractions.length > 0) {
    lines.push('## Agra attractions');
    for (const attraction of attractions) {
      lines.push(`- [${attraction.data.name}](${SITE}/agra/${attraction.slug}): ${attraction.data.description}`);
    }
    lines.push('');
  }

  lines.push('## About');
  lines.push(`- [About IWIS Global](${SITE}/about): registered address, GST details, contact information.`);
  lines.push(`- [No-Commission Pledge](${SITE}/no-commission-pledge): what "no hidden commissions" means in practice.`);
  lines.push('');

  lines.push('## Optional');
  lines.push(`- [Full site content](${SITE}/llms-full.txt): every tour, guide, and attraction page's complete text in one file.`);
  lines.push(`- [Help Center](${SITE}/help)`);
  lines.push(`- [Privacy Policy](${SITE}/privacy)`);
  lines.push(`- [Terms of Service](${SITE}/terms)`);

  return new Response(lines.join('\n') + '\n', {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};

// Cached at the edge (see edgeCache.ts); HEAD answered too, not a 404.
export const GET: APIRoute = (context) => edgeCached(context, () => build(context.locals));
export const HEAD = GET;
