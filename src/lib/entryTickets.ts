// Monument entry tickets staff must buy on ASI's site for a booking. ASI has
// no API, so this only works out *what* to buy; staff buy it by hand, then
// record it (and optionally upload the e-ticket) on the admin booking page.
//
// A booking needs a ticket when either:
//  - the tour builds it into the price (tour.entryTicketsInPrice), or
//  - the customer chose a ticket add-on (name contains "entry ticket").
// Each ticket is one per traveler, except a flat (non-per-traveler) add-on.

import type { ParsedTour } from './tours';

// Official ASI booking portal (linked from ASI's own channels; tajmahal.gov.in
// and asiagracircle.in point here for online tickets).
export const ASI_BOOKING_URL = 'https://asi.paygov.org.in/asi-webapp/#/ticketbooking';

const TICKET_ADDON = /entry ticket/i;

// Whether an add-on is a monument entry ticket (by its name).
export function isEntryTicketAddOn(name: string): boolean {
  return TICKET_ADDON.test(name);
}

export interface TicketLine {
  name: string;
  quantity: number;
}

// Add-on IDs gained a "<TOUR_ID>_" prefix (tours.ts replaceAddOns) when a tour
// is re-saved, so a booking made before that save stores the bare ID. Compare
// both forms.
function bareAddOnId(id: string, tourId: string): string {
  return id.startsWith(`${tourId}_`) ? id.slice(tourId.length + 1) : id;
}

// Names of the add-ons a booking chose (bookings.add_on_ids, comma-separated
// or as sent at checkout), in the tour's own order. Shown to the guest on the
// confirmation page and email.
export function chosenAddOnNames(tour: Pick<ParsedTour, 'id' | 'addOns'>, addOnIds: string | string[]): string[] {
  const ids = typeof addOnIds === 'string' ? addOnIds.split(',') : addOnIds;
  const chosen = new Set(ids.map((s) => s.trim()).filter(Boolean).map((id) => bareAddOnId(id, tour.id)));
  return tour.addOns.filter((addOn) => chosen.has(bareAddOnId(addOn.id, tour.id))).map((addOn) => addOn.name);
}

export function computeTicketsToBuy(
  tour: Pick<ParsedTour, 'id' | 'entryTicketsInPrice' | 'addOns'>,
  booking: { add_on_ids: string; travelers: number }
): TicketLine[] {
  const lines = new Map<string, number>();
  const add = (name: string, qty: number) => lines.set(name, (lines.get(name) ?? 0) + qty);

  for (const name of tour.entryTicketsInPrice) add(name, booking.travelers);

  const chosen = new Set(
    booking.add_on_ids
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((id) => bareAddOnId(id, tour.id))
  );
  for (const addOn of tour.addOns) {
    if (!TICKET_ADDON.test(addOn.name)) continue;
    if (!chosen.has(bareAddOnId(addOn.id, tour.id))) continue;
    add(addOn.name, addOn.perTraveler ? booking.travelers : 1);
  }

  return [...lines].map(([name, quantity]) => ({ name, quantity }));
}

// Still outstanding: a confirmed booking that needs tickets nobody has
// marked as bought yet.
export function ticketsOutstanding(
  booking: { status: string; tickets_purchased_at: string | null },
  lines: TicketLine[]
): boolean {
  return booking.status === 'confirmed' && lines.length > 0 && !booking.tickets_purchased_at;
}
