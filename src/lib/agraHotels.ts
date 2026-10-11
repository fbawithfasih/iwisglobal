// The homepage "Top hotels to stay in Agra" carousel. Ratings, review counts
// and average standard-room rates are the figures in our hotels ranking post
// (/blog/premium-and-luxury-hotels-in-agra), taken from TripAdvisor and
// checked on 11 October 2026; update both together. `avgInr` is the middle of
// TripAdvisor's average nightly range for a standard room, rounded: a planning
// figure, not a quote. Descriptions are in the dictionaries (`hotels.desc`),
// in this same order.

export const HOTELS_CHECKED_ON = '2026-10-11';
// The rate the ranking post uses to turn TripAdvisor's dollar figures into rupees.
const INR_PER_USD = 96;

export interface AgraHotel {
  name: string;
  rank: number; // TripAdvisor rank among 286 Agra hotels
  rating: number;
  reviews: number;
  avgInr: number;
}

export const AGRA_HOTELS: AgraHotel[] = [
  { name: 'The Oberoi Amarvilas', rank: 1, rating: 4.9, reviews: 5600, avgInr: 113000 },
  { name: 'Jaypee Palace Hotel & Convention Centre', rank: 2, rating: 4.5, reviews: 5300, avgInr: 16800 },
  { name: 'DoubleTree by Hilton Agra', rank: 6, rating: 4.7, reviews: 5800, avgInr: 11800 },
  { name: 'Trident, Agra', rank: 8, rating: 4.7, reviews: 6000, avgInr: 11200 },
  { name: 'Tajview, Agra (IHCL SeleQtions)', rank: 13, rating: 4.4, reviews: 4100, avgInr: 17200 },
  { name: 'Courtyard by Marriott Agra', rank: 18, rating: 4.7, reviews: 6200, avgInr: 13100 },
  { name: 'Grand Mercure Agra', rank: 19, rating: 4.8, reviews: 1600, avgInr: 13100 },
  { name: 'ITC Mughal, a Luxury Collection Resort & Spa', rank: 24, rating: 4.4, reviews: 9400, avgInr: 20700 },
  { name: 'Taj Agra', rank: 26, rating: 4.5, reviews: 10900, avgInr: 15000 },
  { name: 'Radisson Hotel Agra', rank: 56, rating: 4.6, reviews: 5000, avgInr: 11400 },
];

// Whole rupees or dollars (to the nearest $5) for the visitor's currency.
export function hotelAvgPrice(avgInr: number, currency: 'INR' | 'USD'): { amount: number; currency: 'INR' | 'USD' } {
  return currency === 'USD' ? { amount: Math.round(avgInr / INR_PER_USD / 5) * 5, currency } : { amount: avgInr, currency };
}
