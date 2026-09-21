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

export const collections = { guides };
