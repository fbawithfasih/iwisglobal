// Ranks tours for the find-my-tour guide from three answers. Pure, so a node
// script can test it. Prices stay out of the score except as a tie-break:
// the guide suggests, the booking widget and server decide what is charged.

import { tagsFor, type TourTag } from './tourMeta';

export type When = 'sunrise' | 'day' | 'night' | 'any';
export type Who = 'small' | 'group' | 'any';
export type Style = 'train' | 'luxury' | 'overnight' | 'value' | 'any';

export interface Answers {
  when: When;
  who: Who;
  style: Style;
}

export interface MatchTour {
  slug: string;
  fromAmount: number;
}

export interface Match {
  slug: string;
  score: number;
  reasons: string[];
}

const WHEN_TAG: Partial<Record<When, TourTag>> = { sunrise: 'sunrise', day: 'day', night: 'night' };
const WHEN_REASON: Record<string, string> = {
  sunrise: 'Built around the Taj at sunrise',
  day: 'A full daytime tour',
  night: 'Seen by moonlight, on the official night-viewing nights',
};
const STYLE_REASON: Record<string, string> = {
  train: 'Travels by Gatimaan Express, the fast train',
  luxury: 'A premium private car',
  overnight: 'Stays overnight, so you are not rushing',
  value: 'The best price per person for a day tour',
};

// nightAvailable: false when no night-viewing night is left in the published
// calendar; the moonlight tour is then left out rather than recommended.
export function recommendTours(tours: MatchTour[], answers: Answers, nightAvailable: boolean): Match[] {
  const ranked: (Match & { price: number })[] = [];
  for (const tour of tours) {
    const tags = tagsFor(tour.slug);
    // A tour with no entry in tourMeta is not recommendable yet.
    if (tags.length === 0) continue;
    if (tags.includes('night') && !nightAvailable) continue;
    // Someone who wants a daytime or sunrise tour is not shown the night one.
    if (tags.includes('night') && (answers.when === 'day' || answers.when === 'sunrise')) continue;

    // Small head start for the flagship day tour, so "not sure" answers land somewhere sensible.
    let score = tags.includes('value') ? 0.5 : 0;
    const reasons: string[] = [];
    const wantTag = WHEN_TAG[answers.when];
    if (wantTag && tags.includes(wantTag)) {
      score += 3;
      reasons.push(WHEN_REASON[answers.when]);
    }
    if (answers.style !== 'any' && tags.includes(answers.style)) {
      score += 3;
      reasons.push(STYLE_REASON[answers.style]);
    }
    if (answers.who === 'group' && tags.includes('group-price')) {
      score += 1;
      reasons.push('The price per person drops as your group grows');
    }
    ranked.push({ slug: tour.slug, score, reasons, price: tour.fromAmount });
  }
  ranked.sort((a, b) => b.score - a.score || a.price - b.price);
  return ranked.map(({ slug, score, reasons }) => ({ slug, score, reasons }));
}
