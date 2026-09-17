import { defineCollection, z } from 'astro:content';

const toursCollection = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    // One-line summary used on the tour card and as the page meta description.
    summary: z.string(),
    // Server-side pricing lives in src/lib/catalog.ts, keyed by this tourId.
    // This field must match a key there.
    tourId: z.string(),
    durationLabel: z.string(), // e.g. "Same-day (12 hrs)", "2 days / 1 night"
    startPoint: z.string(),    // e.g. "Delhi Airport / New Delhi hotels"
    highlights: z.array(z.string()).default([]),
    itinerary: z
      .array(
        z.object({
          time: z.string(), // e.g. "6:00 AM"
          activity: z.string(),
        })
      )
      .default([]),
    includes: z.array(z.string()).default([]),
    excludes: z.array(z.string()).default([]),
    image: z.string().optional(),
    featured: z.boolean().default(false),
  }),
});

export const collections = {
  tours: toursCollection,
};
