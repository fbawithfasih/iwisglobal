import type { APIRoute } from 'astro';
import { razorpayProvider } from '../../lib/payments/razorpay';
import { computeTotal, computeDepositAmount, applyFoundingGuestDiscount } from '../../lib/catalog';
import { getCatalogItem } from '../../lib/tours';
import { FOUNDING_GUEST_OFFER_ID } from '../../lib/offers';
import { insertVerifiedBooking, MAX_TRAVELERS_PER_DATE } from '../../lib/db';
import { resolveEnv } from '../../lib/env';
import { getSessionCustomerId } from '../../lib/requireCustomer';
import { getTourById } from '../../lib/tours';
import { sendBookingConfirmationEmail } from '../../lib/email';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  try {
    const body = await request.json();
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      travelerName,
      travelerEmail,
      travelerPhone,
    } = body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return new Response(JSON.stringify({ error: 'Missing required payment fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const env = resolveEnv(locals);

    const verified = await razorpayProvider.verifyPayment(
      { orderId: razorpay_order_id, paymentId: razorpay_payment_id, signature: razorpay_signature },
      env
    );

    const item = await getCatalogItem(env.DB, verified.tourId, { onlyPublished: false, currency: verified.currency });
    if (!item) {
      return new Response(JSON.stringify({ error: 'Booking references an unknown tour' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Mirrors razorpay.ts's createOrder computation exactly (major units,
    // then round to paise) so this always matches what was actually charged
    // — including for a deposit, where amountPaid is 25% of totalAmount,
    // and for the Founding Guest offer (backlog 1.1), applied here using
    // the same eligibility decision createOrder made and carried in the
    // trusted order notes — never re-checked against a booking count that
    // may have moved on since the order was created.
    const rawTotalMajorUnits = computeTotal(item, verified.travelers, verified.addOnIds);
    // The discount createOrder decided (src/lib/offers.ts), from the order
    // notes. Orders created before offers existed only carry the Founding
    // Guest flag.
    const discountMajorUnits =
      verified.discount ?? (verified.foundingGuestDiscount ? rawTotalMajorUnits - applyFoundingGuestDiscount(rawTotalMajorUnits, true) : 0);
    const totalMajorUnits = rawTotalMajorUnits - discountMajorUnits;
    const discountLabel =
      verified.discountLabel ?? (discountMajorUnits > 0 && verified.foundingGuestDiscount ? 'Founding Guest Offer (15% off)' : null);
    const totalAmount = Math.round(totalMajorUnits * 100);
    const chargeMajorUnits = verified.paymentType === 'deposit' ? computeDepositAmount(totalMajorUnits) : totalMajorUnits;
    const amountPaid = Math.round(chargeMajorUnits * 100);

    const db = env.DB;
    if (db) {
      const customerId = await getSessionCustomerId(cookies, env.CUSTOMER_SESSION_SECRET);
      const outcome = await insertVerifiedBooking(
        db,
        {
          id: `bk_${verified.paymentId}`,
          paymentId: verified.paymentId,
          orderId: verified.orderId,
          tourId: verified.tourId,
          travelDate: verified.date,
          travelers: verified.travelers,
          addOnIds: verified.addOnIds,
          travelerName: travelerName || '',
          travelerEmail: travelerEmail || '',
          travelerPhone: travelerPhone || '',
          amountPaid,
          currency: item.currency,
          customerId,
          totalAmount,
          paymentType: verified.paymentType,
          offerId: discountMajorUnits > 0 ? verified.offerId ?? FOUNDING_GUEST_OFFER_ID : null,
          discountLabel: discountMajorUnits > 0 ? discountLabel : null,
          discountAmount: discountMajorUnits > 0 ? Math.round(discountMajorUnits * 100) : null,
        },
        MAX_TRAVELERS_PER_DATE
      );

      if (outcome === 'capacity_exceeded') {
        let refunded = false;
        try {
          await razorpayProvider.refundPayment(verified.paymentId, env);
          refunded = true;
        } catch (refundError) {
          console.error('verify-payment refund error:', refundError);
        }
        return new Response(
          JSON.stringify({
            error: refunded
              ? 'This date just sold out while your payment was processing. You have been fully refunded — please choose another date.'
              : 'This date just sold out while your payment was processing. Please contact support for a refund.',
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Best-effort — only on the first insert, never on a retried/duplicate
      // request, and never allowed to affect the response (see email.ts).
      if (outcome === 'inserted') {
        const tour = await getTourById(db, verified.tourId);
        await sendBookingConfirmationEmail(env, {
          to: travelerEmail || '',
          travelerName: travelerName || '',
          tourTitle: tour?.title || 'your tour',
          travelDate: verified.date,
          travelers: verified.travelers,
          amountPaid,
          currency: item.currency,
          bookingId: `bk_${verified.paymentId}`,
          totalAmount,
          paymentType: verified.paymentType,
          discountLabel: discountMajorUnits > 0 ? discountLabel : null,
          discountAmount: discountMajorUnits > 0 ? Math.round(discountMajorUnits * 100) : null,
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        payment_id: verified.paymentId,
        tourId: verified.tourId,
        date: verified.date,
        travelers: verified.travelers,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('verify-payment error:', error);
    const msg = error?.message || 'Internal server error';
    const status = /signature verification failed/i.test(msg) ? 400 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
