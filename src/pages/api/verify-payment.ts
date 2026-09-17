import type { APIRoute } from 'astro';
import { razorpayProvider } from '../../lib/payments/razorpay';
import { getCatalogItem, computeTotal } from '../../lib/catalog';
import { insertBooking } from '../../lib/db';
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

    const item = getCatalogItem(verified.tourId);
    if (!item) {
      return new Response(JSON.stringify({ error: 'Booking references an unknown tour' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const amountPaid = Math.round(computeTotal(item, verified.travelers, verified.addOnIds) * 100);

    const db = env.DB;
    if (db) {
      await insertBooking(db, {
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
      });
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
