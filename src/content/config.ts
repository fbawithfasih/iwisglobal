// Content collection for backlog 2.6's five Viator-FAQ counter-pages
// (product-marketing-context.md §6) — the first content in this repo, so
// this file establishes the collection rather than extending one.
import { defineCollection, z } from 'astro:content';

const guides = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    // Real, named attribution — CLAUDE.md hard rule 5 (every informational
    // page needs a named author) and hard rule 1 (never invent a person).
    // "IWIS Global" (the real operator) until a named individual + real
    // credentials are supplied — see session notes.
    authorName: z.string().default('IWIS Global'),
    datePublished: z.date(),
    dateModified: z.date(),
  }),
});

// Backlog 2.7 — Agra attraction landing pages. Every figure here is sourced
// to ASI/tajmahal.gov.in (fetched live) or cross-checked aggregators when
// the primary source wasn't reachable — same sourcing discipline as guides.
const attractions = defineCollection({
  type: 'content',
  schema: z.object({
    name: z.string(),
    description: z.string(),
    ticketPriceForeign: z.string(),
    ticketPriceIndian: z.string(),
    hours: z.string(),
    closedFriday: z.boolean(),
    distanceFromTaj: z.string(),
    dateModified: z.date(),
  }),
});

// Blog — company news/updates, travel stories/tips, seasonal content.
// Separate from `guides` (structured Q&A/reference content) on purpose:
// different tone and purpose, not a replacement. Infrastructure only for
// now — no posts yet; real content is added later the same way guides
// were (one markdown file per post), never fabricated ahead of time.
const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    category: z.enum(['news', 'travel-tips', 'seasonal']),
    authorName: z.string().default('IWIS Global'),
    datePublished: z.date(),
    dateModified: z.date(),
  }),
});

export const collections = { guides, attractions, blog };
