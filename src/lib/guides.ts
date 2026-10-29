// Reading order for guides wherever they're listed (/guides, the /agra hub):
// trip-planning questions first (what travelers search for most), then any
// guide not listed here (newest first), and our own comparison piece always
// last, so a new guide never lands below it.
const GUIDE_ORDER = [
  'taj-mahal-ticket-price-2026',
  'how-to-avoid-taj-mahal-scams',
  'best-time-to-visit-taj-mahal',
  'taj-mahal-opening-hours-closed-friday',
  'delhi-to-agra-one-day-car-or-gatimaan-express',
  'add-agra-day-to-india-trip',
  'is-one-day-enough-taj-mahal',
  'what-not-to-bring-taj-mahal',
  'taj-mahal-tripod-photography-rules',
];
const ALWAYS_LAST = ['iwis-vs-viator-getyourguide'];

const rank = (slug: string) => {
  if (ALWAYS_LAST.includes(slug)) return GUIDE_ORDER.length + 1 + ALWAYS_LAST.indexOf(slug);
  const i = GUIDE_ORDER.indexOf(slug);
  return i === -1 ? GUIDE_ORDER.length : i;
};

export function sortGuides<T extends { slug: string; data: { datePublished: Date } }>(guides: T[]): T[] {
  return [...guides].sort(
    (a, b) => rank(a.slug) - rank(b.slug) || b.data.datePublished.getTime() - a.data.datePublished.getTime()
  );
}
