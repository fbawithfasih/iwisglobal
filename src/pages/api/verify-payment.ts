import type { APIRoute } from 'astro';
import { razorpayProvider } from '../../lib/payments/razorpay';
import { finalizeTourBooking } from '../../lib/tourBooking';
import { resolveEnv } from '../../lib/env';
import { getSessionCustomerId } from '../../lib/requireCustomer';
import { resolveLocale } from '../../lib/i18n';

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

    // The guest's language: the lang cookie is set by the /es /fr /de pages.
    const locale = resolveLocale(new URL(request.url).searchParams, cookies.get('lang')?.value);
    const db = env.DB;
    if (db) {
      const outcome = await finalizeTourBooking(env, db, {
        verified,
        travelerName,
        travelerEmail,
        travelerPhone,
        locale,
        customerId: await getSessionCustomerId(cookies, env.CUSTOMER_SESSION_SECRET),
      });
      if (outcome === 'refunded' || outcome === 'refund_failed') {
        return new Response(
          JSON.stringify({
            error:
              outcome === 'refunded'
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
