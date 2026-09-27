// Reading order for guides wherever they're listed (/guides, the /agra hub):
// trip-planning questions first (what travelers search for most), our own
// comparison piece last. Guides not listed here follow, newest first.
const GUIDE_ORDER = [
  'taj-mahal-ticket-price-2026',
  'best-time-to-visit-taj-mahal',
  'is-one-day-enough-taj-mahal',
  'what-not-to-bring-taj-mahal',
  'taj-mahal-tripod-photography-rules',
  'iwis-vs-viator-getyourguide',
];

const rank = (slug: string) => {
  const i = GUIDE_ORDER.indexOf(slug);
  return i === -1 ? GUIDE_ORDER.length : i;
};

export function sortGuides<T extends { slug: string; data: { datePublished: Date } }>(guides: T[]): T[] {
  return [...guides].sort(
    (a, b) => rank(a.slug) - rank(b.slug) || b.data.datePublished.getTime() - a.data.datePublished.getTime()
  );
}
