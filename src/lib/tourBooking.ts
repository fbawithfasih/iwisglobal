import type { D1Like } from './db';
import { insertVerifiedBooking, MAX_TRAVELERS_PER_DATE } from './db';
import type { VerifiedBooking } from './payments';
import { razorpayProvider } from './payments/razorpay';
import { trackLeadEvent } from './contacts';
import { getTourById, localizeTour } from './tours';
import { emailLocale, type Locale } from './i18n';
import { sendAdminBookingNotificationEmail, sendBookingConfirmationEmail } from './email';
import { chosenAddOnNames } from './entryTickets';
import { FOUNDING_GUEST_OFFER_ID } from './offers';

// Records a paid tour booking. Called by the browser after Razorpay's checkout (src/pages/api/verify-payment.ts) and
// by Razorpay's payment webhook (src/pages/api/webhooks/razorpay.ts), so a booking is never lost when the guest's
// browser does not come back after paying. Both can run for the same payment: the booking id is derived from the
// payment, so the second one finds it already there and sends nothing again.

export type TourBookingOutcome = 'inserted' | 'duplicate' | 'refunded' | 'refund_failed';

export interface TourBookingInput {
  verified: VerifiedBooking;
  // Contact details sent by the browser; anything missing falls back to what the order carries.
  travelerName?: string;
  travelerEmail?: string;
  travelerPhone?: string;
  locale?: string;
  customerId?: string | null;
}

export async function finalizeTourBooking(env: Record<string, any>, db: D1Like, i: TourBookingInput): Promise<TourBookingOutcome> {
  const v = i.verified;
  const name = (i.travelerName || v.guest.name || '').trim();
  const email = (i.travelerEmail || v.guest.email || '').trim();
  const phone = (i.travelerPhone || v.guest.phone || '').trim();
  const locale = emailLocale(i.locale || v.guest.locale) as Locale;
  // The amounts fixed when the order was created, and what Razorpay actually charged: never re-priced from today's catalog.
  const discountMinor = v.discount != null ? Math.round(v.discount * 100) : 0;
  const discountLabel = discountMinor > 0 ? v.discountLabel ?? (v.foundingGuestDiscount ? 'Founding Guest Offer (15% off)' : null) : null;
  const bookingId = `bk_${v.paymentId}`;

  const outcome = await insertVerifiedBooking(
    db,
    {
      id: bookingId,
      paymentId: v.paymentId,
      orderId: v.orderId,
      tourId: v.tourId,
      travelDate: v.date,
      travelers: v.travelers,
      addOnIds: v.addOnIds,
      travelerName: name,
      travelerEmail: email,
      travelerPhone: phone,
      amountPaid: v.amountCharged,
      currency: v.currency,
      customerId: i.customerId ?? null,
      totalAmount: v.totalAmount,
      paymentType: v.paymentType,
      offerId: discountMinor > 0 ? v.offerId ?? FOUNDING_GUEST_OFFER_ID : null,
      discountLabel,
      discountAmount: discountMinor > 0 ? discountMinor : null,
      locale,
    },
    MAX_TRAVELERS_PER_DATE
  );

  if (outcome === 'duplicate') {
    // The webhook may have recorded it first; keep the signed-in guest's account link from the browser call.
    if (i.customerId) await db.prepare(`UPDATE bookings SET customer_id = ? WHERE payment_id = ? AND customer_id IS NULL`).bind(i.customerId, v.paymentId).run();
    return 'duplicate';
  }
  if (outcome === 'capacity_exceeded') {
    // The date sold out between creating the order and paying: give the money back in full.
    try {
      await razorpayProvider.refundPayment(v.paymentId, env);
      return 'refunded';
    } catch (err) {
      console.error('tour booking: refund after sell-out failed', v.paymentId, err instanceof Error ? err.message : 'error');
      return 'refund_failed';
    }
  }

  // Best-effort from here: the booking is saved, and nothing below may undo that.
  await trackLeadEvent(db, {
    channel: 'booking',
    identifiers: [{ type: 'email', value: email }, { type: 'phone', value: phone }],
    name,
    language: locale,
    externalRef: `booking:${bookingId}`,
    stage: v.paymentType === 'deposit' ? 'deposit_paid' : 'booked',
    travelStart: v.date,
    partySize: v.travelers,
    bookingId,
    note: v.paymentType === 'deposit' ? 'Booking deposit paid' : 'Booking paid in full',
    attribution: {
      source: v.attribution.source || undefined,
      medium: v.attribution.medium || undefined,
      campaign: v.attribution.campaign || undefined,
      landingPage: v.attribution.landingPage || undefined,
      gclid: v.attribution.gclid || undefined,
      fbclid: v.attribution.fbclid ? 'yes' : undefined,
    },
  });
  try {
    const tour = await getTourById(db, v.tourId);
    const shown = tour ? await localizeTour(db, tour, locale) : null;
    await sendBookingConfirmationEmail(env, {
      to: email,
      travelerName: name,
      tourTitle: shown?.title || 'your tour',
      locale,
      travelDate: v.date,
      travelers: v.travelers,
      amountPaid: v.amountCharged,
      currency: v.currency,
      bookingId,
      paymentId: v.paymentId,
      totalAmount: v.totalAmount,
      paymentType: v.paymentType,
      discountLabel,
      discountAmount: discountMinor > 0 ? discountMinor : null,
      addOnNames: shown ? chosenAddOnNames(shown, v.addOnIds) : [],
    });
    await sendAdminBookingNotificationEmail(env, {
      travelerName: name,
      travelerEmail: email,
      travelerPhone: phone,
      tourTitle: tour?.title || v.tourId,
      travelDate: v.date,
      travelers: v.travelers,
      amountPaid: v.amountCharged,
      totalAmount: v.totalAmount,
      currency: v.currency,
      bookingId,
      paymentType: v.paymentType,
      discountLabel,
    });
  } catch (err) {
    console.error('tour booking: emails failed', bookingId, err instanceof Error ? err.message : 'error');
  }
  return 'inserted';
}
