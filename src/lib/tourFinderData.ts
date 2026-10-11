// Turns published tours into the plain props the find-my-tour island needs
// (formatted "From" price included), so the home and tours pages share it.

import { CURRENCY_SYMBOLS, resolveFromPrice, type Currency } from './currency';
import type { ParsedTour } from './tours';
import type { FinderTour } from '../components/TourFinder';

export function toFinderTours(tours: ParsedTour[], currency: Currency): FinderTour[] {
  return tours.map((tour) => {
    const price = resolveFromPrice(tour, currency);
    return {
      slug: tour.slug,
      title: tour.title,
      image: tour.image,
      durationLabel: tour.durationLabel,
      fromAmount: price.amount,
      fromLabel: `${CURRENCY_SYMBOLS[price.currency]}${price.amount.toLocaleString(price.currency === 'USD' ? 'en-US' : 'en-IN')}`,
    };
  });
}
