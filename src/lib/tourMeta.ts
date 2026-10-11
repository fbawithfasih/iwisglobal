// What each tour is like, for the find-my-tour guide. Keyed by slug and kept
// beside the code on purpose: the guide is a convenience, so a tour with no
// entry here (a new one added in the admin) simply gets no tags, is ranked
// by price, and never breaks the page. Add its slug here to make it
// recommendable.

export type TourTag = 'sunrise' | 'day' | 'night' | 'train' | 'luxury' | 'overnight' | 'value' | 'group-price';

export const TOUR_TAGS: Record<string, TourTag[]> = {
  'taj-mahal-moonlight-night-viewing-tour': ['night'],
  'same-day-agra-from-delhi': ['day', 'value', 'group-price'],
  'agra-private-sightseeing-tour': ['day'],
  'taj-mahal-sunrise-tour': ['sunrise', 'group-price'],
  'same-day-taj-mahal-tour-by-gatimaan-express': ['day', 'train', 'group-price'],
  'agra-overnight-tour-from-delhi': ['overnight'],
  'agra-mathura-vrindavan-overnight-tour': ['overnight'],
  'taj-mahal-luxury-car-tour-from-delhi': ['day', 'luxury'],
};

export function tagsFor(slug: string): TourTag[] {
  return TOUR_TAGS[slug] ?? [];
}
