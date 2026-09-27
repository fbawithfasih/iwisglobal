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
    // SAARC/BIMSTEC nationals' ticket, shown as its own row when set.
    ticketPriceSaarc: z.string().optional(),
    hours: z.string(),
    closedFriday: z.boolean(),
    distanceFromTaj: z.string(),
    dateModified: z.date(),
    // Optional photo under the title: src is the largest copy, srcset lists
    // the smaller ones (files live in /public).
    image: z.object({ src: z.string(), srcset: z.string(), alt: z.string(), width: z.number(), height: z.number() }).optional(),
  }),
});

// Blog was originally a git-based collection here (infrastructure-only,
// no posts). Replaced with a D1-backed version (src/lib/blog.ts,
// /admin/blog) so posts can be published from a browser form without a
// redeploy — see schema_blog_posts.sql.

export const collections = { guides, attractions };
