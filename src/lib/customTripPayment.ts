// Payment and lifecycle of a custom Agra trip (src/lib/customTrip.ts):
//
//   order     the browser posts its selections and contact details; the server
//             re-validates and re-prices them from the saved rates, saves what
//             it will charge in custom_trips, and opens a Razorpay order for
//             the deposit. The browser's own total is never used.
//   verify    after the guest pays, verify Razorpay's signature, read the order
//             back from Razorpay, check it against what was saved, then record
//             the booking (status "awaiting_confirmation") and send the emails.
//   confirm / cancel   the owner decides; cancel refunds the deposit in full.
//
// Finalising is safe to repeat: a guest's retry, the Razorpay webhook and the
// verify call can all arrive, and only the first one books the trip.

import { trackLeadEvent } from './contacts';
import type { D1Like } from './db';
import { isCustomEnabled, loadRates } from './customTripData';
import {
  parseContact,
  parseTripInput,
  priceTrip,
  travellerTotal,
  validateContact,
  type HotelChoice,
  type TripInput,
  type TripQuote,
} from './customTrip';
import { createCustomTripOrder, fetchRazorpayOrder, razorpayProvider, verifyRazorpaySignature } from './payments/razorpay';
import { sendCustomTripAdminEmail, sendCustomTripGuestEmail, type CustomTripEmailDetails } from './email';
import type { Locale } from './i18n';

export const CUSTOM_TOUR_ID = 'CUSTOM_AGRA';
export const AWAITING_STATUS = 'awaiting_confirmation';

export interface CustomTripRow {
  id: string;
  status: string; // quoted | deposit_paid | confirmed | cancelled
  currency: string;
  trip_json: string;
  price_json: string;
  total: number;
  deposit: number;
  order_id: string;
  booking_id: string;
  name: string;
  email: string;
  phone: string;
  created_at: string;
  updated_at: string;
}

export interface StoredTrip {
  input: TripInput;
  quote: TripQuote;
  locale: Locale;
}

const LOCALES: Locale[] = ['en', 'es', 'fr', 'de'];
const asLocale = (v: unknown): Locale => (LOCALES.includes(v as Locale) ? (v as Locale) : 'en');

export async function getCustomTrip(db: D1Like, id: string): Promise<CustomTripRow | null> {
  return db.prepare(`SELECT * FROM custom_trips WHERE id = ?`).bind(id).first<CustomTripRow>();
}

export async function getCustomTripByBooking(db: D1Like, bookingId: string): Promise<CustomTripRow | null> {
  return db.prepare(`SELECT * FROM custom_trips WHERE booking_id = ?`).bind(bookingId).first<CustomTripRow>();
}

// The selections and the exact breakdown that was charged, as saved.
export function readStoredTrip(trip: CustomTripRow): StoredTrip | null {
  try {
    const saved = JSON.parse(trip.trip_json);
    const input = parseTripInput(saved);
    const quote = JSON.parse(trip.price_json) as TripQuote;
    if (!input || !quote || !Array.isArray(quote.days)) return null;
    return { input, quote, locale: asLocale(saved.locale) };
  } catch {
    return null;
  }
}

function emailDetails(trip: CustomTripRow, stored: StoredTrip): CustomTripEmailDetails {
  const { quote, input } = stored;
  return {
    tripId: trip.id,
    startDate: quote.startDate,
    endDate: quote.endDate,
    days: quote.days.map((d) => ({ date: d.date, stops: d.stops.map((s) => ({ id: s.id, name: s.name })) })),
    vehicleId: quote.vehicle.id,
    vehicleName: quote.vehicle.name,
    guests: travellerTotal(quote.travellers),
    currency: trip.currency,
    depositMinor: trip.deposit * 100,
    totalMinor: trip.total * 100,
    hotel: input.hotel as HotelChoice,
  };
}

export interface HandlerResult {
  status: number;
  body: Record<string, unknown>;
}

// POST /api/custom-trip/order
export async function handleOrder(env: Record<string, any>, db: D1Like | undefined, raw: unknown, now: Date = new Date()): Promise<HandlerResult> {
  if (!db) return { status: 503, body: { error: 'unavailable' } };
  if (!(await isCustomEnabled(db))) return { status: 403, body: { error: 'not_available' } };

  const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const input = parseTripInput(body.trip);
  const contact = parseContact(body.contact);
  if (!input || !contact) return { status: 400, body: { error: 'bad_request' } };
  const contactErrors = validateContact(contact);
  if (Object.keys(contactErrors).length > 0) return { status: 400, body: { error: 'bad_contact', fields: Object.keys(contactErrors) } };

  const priced = priceTrip(input, await loadRates(db), now);
  if (!priced.ok) {
    return { status: 400, body: { error: 'invalid_trip', errors: priced.errors.map((e) => ({ code: e.code, params: e.params, day: e.day })) } };
  }
  const quote = priced.quote;
  const locale = asLocale(body.locale);

  const id = `ct_${crypto.randomUUID()}`;
  const stamp = now.toISOString();
  await db
    .prepare(
      `INSERT INTO custom_trips (id, status, currency, trip_json, price_json, total, deposit, name, email, phone, created_at, updated_at)
       VALUES (?, 'quoted', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, quote.currency, JSON.stringify({ ...input, locale }), JSON.stringify(quote), quote.total, quote.deposit, contact.name, contact.email, contact.phone, stamp, stamp)
    .run();

  try {
    const order = await createCustomTripOrder(env, { amountMinor: quote.deposit * 100, currency: quote.currency, tripId: id, receipt: id });
    await db.prepare(`UPDATE custom_trips SET order_id = ?, updated_at = ? WHERE id = ?`).bind(order.orderId, stamp, id).run();
    await trackLeadEvent(db, {
      channel: 'custom_trip',
      identifiers: [{ type: 'email', value: contact.email }, { type: 'phone', value: contact.phone }],
      name: contact.name,
      language: locale,
      externalRef: `quote:${id}`,
      stage: 'quote_sent',
      travelStart: quote.startDate,
      partySize: travellerTotal(quote.travellers),
      message: 'Priced a custom trip and opened the deposit payment',
    });
    return { status: 200, body: { tripId: id, orderId: order.orderId, amount: order.amount, currency: order.currency, publicKey: order.publicKey } };
  } catch (e) {
    await db.prepare(`DELETE FROM custom_trips WHERE id = ? AND status = 'quoted'`).bind(id).run();
    return { status: 502, body: { error: e instanceof Error ? e.message : 'Failed to create order' } };
  }
}

// POST /api/custom-trip/verify
export async function handleVerify(env: Record<string, any>, db: D1Like | undefined, raw: unknown): Promise<HandlerResult> {
  if (!db) return { status: 503, body: { error: 'unavailable' } };
  const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const orderId = typeof body.razorpay_order_id === 'string' ? body.razorpay_order_id : '';
  const paymentId = typeof body.razorpay_payment_id === 'string' ? body.razorpay_payment_id : '';
  const signature = typeof body.razorpay_signature === 'string' ? body.razorpay_signature : '';
  if (!orderId || !paymentId || !signature) return { status: 400, body: { error: 'Missing required payment fields' } };
  if (!(await verifyRazorpaySignature(env, orderId, paymentId, signature))) return { status: 400, body: { error: 'Payment signature verification failed' } };

  // The trip id and the amount come from Razorpay's own record of the order.
  const order = await fetchRazorpayOrder(env, orderId);
  const tripId = order.notes.kind === 'custom' ? order.notes.customTripId : '';
  if (!tripId) return { status: 400, body: { error: 'Not a custom trip payment' } };

  const outcome = await finalizeCustomTrip(env, db, { tripId, orderId, paymentId, amountMinor: order.amount, currency: order.currency });
  if (outcome === 'unknown') return { status: 404, body: { error: 'Trip not found' } };
  if (outcome === 'mismatch') return { status: 409, body: { error: 'Payment does not match the trip. Please contact us.' } };
  return { status: 200, body: { success: true, tripId } };
}

export type FinalizeOutcome = 'finalized' | 'duplicate' | 'unknown' | 'mismatch';

// Records a paid deposit. Only the first caller for a trip gets 'finalized'; a
// retry, the webhook arriving as well, or a double submit gets 'duplicate'.
export async function finalizeCustomTrip(
  env: Record<string, any>,
  db: D1Like,
  paid: { tripId: string; orderId: string; paymentId: string; amountMinor: number; currency: string }
): Promise<FinalizeOutcome> {
  const trip = await getCustomTrip(db, paid.tripId);
  if (!trip) return 'unknown';
  if (trip.order_id !== paid.orderId || trip.currency !== paid.currency || trip.deposit * 100 !== paid.amountMinor) {
    console.error('custom trip payment does not match the saved trip', paid.tripId, paid.orderId);
    return 'mismatch';
  }

  const stamp = new Date().toISOString();
  const claim = await db.prepare(`UPDATE custom_trips SET status = 'deposit_paid', updated_at = ? WHERE id = ? AND status = 'quoted'`).bind(stamp, trip.id).run();
  if (!claim.meta?.changes) return 'duplicate';

  const stored = readStoredTrip(trip);
  const bookingId = `bk_${paid.paymentId}`;
  try {
    if (!stored) throw new Error('Saved trip is unreadable');
    await db
      .prepare(
        `INSERT OR IGNORE INTO bookings
          (id, payment_id, order_id, tour_id, travel_date, travelers, add_on_ids, traveler_name, traveler_email, traveler_phone,
           amount_paid, currency, status, source, pickup_time, guide_assigned, vehicle, created_at, total_amount, payment_type, locale)
         VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, 'custom', '', '', ?, ?, ?, 'deposit', ?)`
      )
      .bind(
        bookingId,
        paid.paymentId,
        paid.orderId,
        CUSTOM_TOUR_ID,
        stored.quote.startDate,
        travellerTotal(stored.quote.travellers),
        trip.name,
        trip.email,
        trip.phone,
        trip.deposit * 100,
        trip.currency,
        AWAITING_STATUS,
        stored.quote.vehicle.name,
        stamp,
        trip.total * 100,
        stored.locale
      )
      .run();
    const saved = await db.prepare(`SELECT 1 FROM bookings WHERE id = ?`).bind(bookingId).first();
    if (!saved) throw new Error('Could not save booking');
    await db.prepare(`UPDATE custom_trips SET booking_id = ?, updated_at = ? WHERE id = ?`).bind(bookingId, stamp, trip.id).run();
  } catch (e) {
    // Let a retry (or the webhook) try again rather than leave a paid trip with no booking.
    await db.prepare(`UPDATE custom_trips SET status = 'quoted', updated_at = ? WHERE id = ?`).bind(stamp, trip.id).run();
    throw e;
  }

  await trackLeadEvent(db, {
    channel: 'custom_trip',
    identifiers: [{ type: 'email', value: trip.email }, { type: 'phone', value: trip.phone }],
    name: trip.name,
    language: stored!.locale,
    externalRef: `paid:${trip.id}`,
    stage: 'deposit_paid',
    travelStart: stored!.quote.startDate,
    bookingId,
    note: 'Custom trip deposit paid',
  });

  const details = emailDetails(trip, stored!);
  await sendCustomTripGuestEmail(env, { ...details, kind: 'received', to: trip.email, name: trip.name, locale: stored!.locale });
  await sendCustomTripAdminEmail(env, { ...details, bookingId, guestName: trip.name, guestEmail: trip.email, guestPhone: trip.phone });
  return 'finalized';
}

type Done = { ok: true } | { ok: false; error: string };

// The owner confirms a paid trip.
export async function confirmCustomTrip(env: Record<string, any>, db: D1Like, tripId: string): Promise<Done> {
  const trip = await getCustomTrip(db, tripId);
  if (!trip) return { ok: false, error: 'That trip was not found.' };
  if (trip.status === 'confirmed') return { ok: true };
  if (trip.status !== 'deposit_paid') return { ok: false, error: 'This trip is not waiting for confirmation.' };
  const stamp = new Date().toISOString();
  const claim = await db.prepare(`UPDATE custom_trips SET status = 'confirmed', updated_at = ? WHERE id = ? AND status = 'deposit_paid'`).bind(stamp, trip.id).run();
  if (!claim.meta?.changes) return { ok: true };
  await db.prepare(`UPDATE bookings SET status = 'confirmed' WHERE id = ?`).bind(trip.booking_id).run();
  const stored = readStoredTrip(trip);
  if (stored) await sendCustomTripGuestEmail(env, { ...emailDetails(trip, stored), kind: 'confirmed', to: trip.email, name: trip.name, locale: stored.locale });
  return { ok: true };
}

// The owner cannot supply the trip: refund the deposit in full and tell the guest.
export async function cancelCustomTrip(env: Record<string, any>, db: D1Like, tripId: string): Promise<Done> {
  const trip = await getCustomTrip(db, tripId);
  if (!trip) return { ok: false, error: 'That trip was not found.' };
  if (trip.status === 'cancelled') return { ok: true };
  if (trip.status !== 'deposit_paid' && trip.status !== 'confirmed') return { ok: false, error: 'This trip has no deposit to refund.' };
  const booking = await db.prepare(`SELECT payment_id FROM bookings WHERE id = ?`).bind(trip.booking_id).first<{ payment_id: string }>();
  if (!booking?.payment_id) return { ok: false, error: 'The booking for this trip was not found.' };

  // Claim first so two clicks cannot refund twice; undo if the refund fails.
  const stamp = new Date().toISOString();
  const claim = await db
    .prepare(`UPDATE custom_trips SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = ?`)
    .bind(stamp, trip.id, trip.status)
    .run();
  if (!claim.meta?.changes) return { ok: true };
  try {
    await razorpayProvider.refundPayment(booking.payment_id, env);
  } catch (e) {
    await db.prepare(`UPDATE custom_trips SET status = ?, updated_at = ? WHERE id = ?`).bind(trip.status, stamp, trip.id).run();
    return { ok: false, error: `The refund did not go through: ${e instanceof Error ? e.message : 'unknown error'}. Nothing was cancelled.` };
  }
  await db.prepare(`UPDATE bookings SET status = 'cancelled' WHERE id = ?`).bind(trip.booking_id).run();
  const stored = readStoredTrip(trip);
  if (stored) await sendCustomTripGuestEmail(env, { ...emailDetails(trip, stored), kind: 'cancelled', to: trip.email, name: trip.name, locale: stored.locale });
  return { ok: true };
}
