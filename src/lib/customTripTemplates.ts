// Ready-made tours a guest can start a day from in "Customise your Agra tour".
// A template only pre-fills a day's stops (and, for a Delhi tour, where the trip
// starts); the day is then priced like any other, by vehicle and guide, so the
// guest can change anything. The tour's name comes from the tours table, in the
// visitor's language. The Gatimaan Express tour is not offered: a train leg does
// not fit a vehicle-and-guide price.

import type { CustomRates, StartPoint } from './customTrip';

export interface TripTemplate {
  slug: string; // the tour's slug
  start: StartPoint;
  vehicleId?: string; // a vehicle the tour implies (offered only if it exists and fits)
  stopIds: string[];
}

export const TRIP_TEMPLATES: TripTemplate[] = [
  { slug: 'same-day-agra-from-delhi', start: 'delhi', stopIds: ['taj-mahal', 'agra-fort'] },
  { slug: 'taj-mahal-sunrise-tour', start: 'delhi', stopIds: ['taj-mahal'] },
  { slug: 'taj-mahal-luxury-car-tour-from-delhi', start: 'delhi', vehicleId: 'luxury', stopIds: ['taj-mahal', 'agra-fort'] },
  { slug: 'agra-private-sightseeing-tour', start: 'agra', stopIds: ['taj-mahal', 'agra-fort', 'itimad-ud-daulah', 'mehtab-bagh'] },
  // Needs a night-viewing stop, which the owner adds in admin; hidden until then.
  { slug: 'taj-mahal-moonlight-night-viewing-tour', start: 'agra', stopIds: ['taj-mahal-night-viewing'] },
];

export interface OfferedTemplate extends TripTemplate {
  title: string;
}

// The templates that can be offered right now: the tour is published (it has a
// title) and every stop it uses is switched on.
export function offeredTemplates(rates: CustomRates, tourTitles: Map<string, string>): OfferedTemplate[] {
  const liveStops = new Set(rates.stops.filter((s) => s.active).map((s) => s.id));
  return TRIP_TEMPLATES.flatMap((t) => {
    const title = tourTitles.get(t.slug);
    if (!title || !t.stopIds.every((id) => liveStops.has(id))) return [];
    return [{ ...t, title }];
  });
}
