// llms-full.txt (llmstxt.org): the companion to /llms.txt that inlines full
// page content instead of one-line links, so an AI crawler can get complete,
// citable answers (tour itineraries, guide bodies, attraction details)
// without crawling every page individually. Neither activities.marriott.com
// nor this site had this before — same dynamic-route reasoning as
// llms.txt.ts (pulls live D1 tour data + content collections, not a
// build-time snapshot that goes stale).
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
    '> Private Taj Mahal & Agra tour operator based in Agra, India. Private same-day trips from Delhi, booked and paid for online, with transparent pricing and no hidden commissions. The full content below is inlined for AI systems that answer from a single fetch rather than crawling every page.'
  );
  lines.push('');

  if (tours.length > 0) {
    lines.push('## Tours');
    lines.push('');
    for (const tour of tours) {
      lines.push(`### ${tour.title}`);
      lines.push(`URL: ${SITE}/tours/${tour.slug}`);
      lines.push(`Price: from ${tour.amount} ${tour.currency} per traveler. Duration: ${tour.durationLabel}. Start point: ${tour.startPoint}.`);
      lines.push('');
      lines.push(tour.summary);
      lines.push('');
      if (tour.highlights.length > 0) {
        lines.push('Highlights:');
        for (const h of tour.highlights) lines.push(`- ${h}`);
        lines.push('');
      }
      if (tour.itinerary.length > 0) {
        lines.push('Itinerary:');
        for (const step of tour.itinerary) lines.push(`- ${step.time}: ${step.activity}`);
        lines.push('');
      }
      if (tour.includes.length > 0) {
        lines.push(`Included: ${tour.includes.join(', ')}.`);
      }
      if (tour.excludes.length > 0) {
        lines.push(`Not included: ${tour.excludes.join(', ')}.`);
      }
      lines.push('');
      lines.push(tour.description);
      lines.push('');
      lines.push('---');
      lines.push('');
    }
  }

  if (guides.length > 0) {
    lines.push('## Guides');
    lines.push('');
    for (const guide of guides) {
      lines.push(`### ${guide.data.title}`);
      lines.push(`URL: ${SITE}/guides/${guide.slug}`);
      lines.push(`By ${guide.data.authorName}. Last updated ${guide.data.dateModified.toISOString().slice(0, 10)}.`);
      lines.push('');
      lines.push(guide.body.trim());
      lines.push('');
      lines.push('---');
      lines.push('');
    }
  }

  if (attractions.length > 0) {
    lines.push('## Agra attractions');
    lines.push('');
    for (const attraction of attractions) {
      lines.push(`### ${attraction.data.name}`);
      lines.push(`URL: ${SITE}/agra/${attraction.slug}`);
      lines.push(
        `Ticket (foreign tourist): ${attraction.data.ticketPriceForeign}. Ticket (Indian national): ${attraction.data.ticketPriceIndian}. ${attraction.data.ticketPriceSaarc ? `Ticket (SAARC/BIMSTEC national): ${attraction.data.ticketPriceSaarc}. ` : ''}Hours: ${attraction.data.hours}. Closed Fridays: ${attraction.data.closedFriday ? 'yes' : 'no'}.`
      );
      lines.push('');
      lines.push(attraction.body.trim());
      lines.push('');
      lines.push('---');
      lines.push('');
    }
  }

  lines.push('## About');
  lines.push(`- [About IWIS Global](${SITE}/about): registered address, GST details, contact information.`);
  lines.push(`- [No-Commission Pledge](${SITE}/no-commission-pledge): what "no hidden commissions" means in practice.`);
  lines.push('');

  lines.push('## Optional');
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
