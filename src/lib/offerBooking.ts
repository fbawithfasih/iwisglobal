// A paid private offer is a booking. The first payment (the full amount or the booking amount) creates one row in bookings, with the guest's
// details and the travel date; the balance payment updates that same row, so the offer is counted once. From there it shows up everywhere a
// booking does: the Bookings list, the Today board, the review requests and the customer's own list. Called from the payment code
// (src/lib/offerPayment.ts) and safe to repeat.

import type { D1Like } from './db';
import { listPaid, readOffer, type OfferContent } from './offerData';
import { offerState } from './offerPricing';
import { sendHotelAlertEmail } from './email';

/** bookings.tour_id for a booking that came from a private offer (there is no tour page behind it). */
export const PRIVATE_OFFER_TOUR_ID = 'private-offer';
export const PRIVATE_OFFER_SOURCE = 'private_offer';

/** The readable name for a tour id on admin screens: a private offer has no tour record. */
export const tourLabel = (tourId: string, title?: string | null): string => (tourId === PRIVATE_OFFER_TOUR_ID ? 'Private offer' : title ?? tourId);

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

const isRealDate = (y: number, m: number, d: number): boolean => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};

/** "Monday, 16 November 2026" or "16 Nov 2026" as 2026-11-16; null when there is no single clear day (or it is not a real date). */
export function parseOfferDate(label: string): string | null {
  const found = [...String(label ?? '').matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/g)];
  const days = new Set<string>();
  for (const m of found) {
    const month = MONTHS.findIndex((name) => name === m[2].toLowerCase() || (m[2].length >= 3 && name.startsWith(m[2].toLowerCase()))) + 1;
    const y = Number(m[3]);
    const d = Number(m[1]);
    if (month > 0 && isRealDate(y, month, d)) days.add(`${y}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return days.size === 1 ? [...days][0] : null;
}

/** The travel day of an offer: an explicit travelDate when the offer has one, else the one day named in its date label. */
export function offerTravelDate(content: Pick<OfferContent, 'travelDate' | 'dateLabel'>): string | null {
  const explicit = content.travelDate?.trim();
  if (explicit && /^\d{4}-\d{2}-\d{2}$/.test(explicit) && isRealDate(Number(explicit.slice(0, 4)), Number(explicit.slice(5, 7)), Number(explicit.slice(8, 10)))) return explicit;
  return parseOfferDate(content.dateLabel);
}

export type OfferBookingResult = 'created' | 'updated' | 'none_paid' | 'internal' | 'no_date' | 'unreadable';

export const offerBookingId = (offerId: string): string => `bk_offer_${offerId}`;

interface PaidRow { payment_id: string; order_id: string; payer_name: string; payer_email: string; payer_phone: string; guide_language: string; option_id: string }

/**
 * Creates the offer's booking from its first paid payment, or brings the existing one up to date with everything paid so far.
 * Returns what happened; throws only when the database fails. An internal test offer (content.internal) never becomes a booking.
 */
export async function recordOfferBooking(db: D1Like, offerId: string): Promise<OfferBookingResult> {
  const offer = await readOffer(db, offerId);
  if (!offer) return 'unreadable';
  const paid = await listPaid(db, offerId);
  if (paid.length === 0) return 'none_paid';
  if (offer.content.internal) return 'internal';
  const travelDate = offerTravelDate(offer.content);
  if (!travelDate) return 'no_date';

  const { results } = await db
    .prepare(`SELECT payment_id, order_id, payer_name, payer_email, payer_phone, guide_language, option_id FROM offer_payments WHERE offer_id = ? AND status = 'paid' ORDER BY updated_at, id`)
    .bind(offerId)
    .all<PaidRow>();
  const first = results?.[0];
  if (!first || !first.payment_id) return 'none_paid';

  const state = offerState(offer.terms, paid);
  const option = offer.terms.options.find((o) => o.id === state.optionId);
  const id = offerBookingId(offerId);
  const totalMinor = state.totalMinor ?? state.paidMinor;
  const paymentType = state.status === 'paid_in_full' ? 'full' : 'deposit';
  const stamp = new Date().toISOString();

  const inserted = await db
    .prepare(
      `INSERT OR IGNORE INTO bookings
        (id, payment_id, order_id, tour_id, travel_date, travelers, add_on_ids, traveler_name, traveler_email, traveler_phone,
         amount_paid, currency, status, source, pickup_time, guide_assigned, vehicle, created_at, total_amount, payment_type, locale)
       VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, 'confirmed', ?, '', '', ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      first.payment_id,
      first.order_id,
      PRIVATE_OFFER_TOUR_ID,
      travelDate,
      offer.content.travellers,
      (first.payer_name || offer.customerName).trim(),
      first.payer_email,
      first.payer_phone || offer.customerPhone,
      state.paidMinor,
      offer.currency,
      PRIVATE_OFFER_SOURCE,
      option?.label ?? '',
      stamp,
      totalMinor,
      paymentType,
      first.guide_language === 'de' ? 'de' : 'en'
    )
    .run();
  const created = (inserted as { meta?: { changes?: number } })?.meta?.changes === 1;
  if (!created) {
    // Already there: bring the amounts up to date (a balance payment arrived). The owner's edits to status and notes stay.
    await db.prepare(`UPDATE bookings SET amount_paid = ?, total_amount = ?, payment_type = ? WHERE id = ?`).bind(state.paidMinor, totalMinor, paymentType, id).run();
  }
  return created ? 'created' : 'updated';
}

/** recordOfferBooking for the payment code: never throws, and tells the owner when a paid offer could not be turned into a booking. */
export async function recordOfferBookingSafe(env: Record<string, any>, db: D1Like, offerId: string): Promise<OfferBookingResult | 'error'> {
  try {
    const result = await recordOfferBooking(db, offerId);
    if (result === 'no_date' || result === 'unreadable') {
      await sendHotelAlertEmail(
        env,
        `Paid private offer is not counted as a booking: ${offerId}`,
        [`Offer: ${offerId}`, result === 'no_date' ? 'Reason: the offer has no single travel date the site can read. Add a travelDate to the offer, then it is counted.' : 'Reason: the offer cannot be read.'].join('\n'),
        'Private offer needs attention'
      );
    }
    return result;
  } catch (e) {
    console.error('private offer: could not record the booking', offerId, e instanceof Error ? e.message : 'error');
    return 'error';
  }
}
