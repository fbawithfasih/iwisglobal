import type { APIRoute } from 'astro';
import { razorpayProvider } from '../../lib/payments/razorpay';
import { computeTotal } from '../../lib/catalog';
import { getCatalogItem } from '../../lib/tours';
import { insertVerifiedBooking, MAX_TRAVELERS_PER_DATE } from '../../lib/db';
import { resolveEnv } from '../../lib/env';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
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

    const amountPaid = Math.round(computeTotal(item, verified.travelers, verified.addOnIds) * 100);

    const db = env.DB;
    if (db) {
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
