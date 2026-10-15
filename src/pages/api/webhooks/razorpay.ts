import type { APIRoute } from 'astro';
import { resolveEnv } from '../../../lib/env';
import { finalizeCustomTrip } from '../../../lib/customTripPayment';
import { fetchRazorpayOrder } from '../../../lib/payments/razorpay';

export const prerender = false;

// Server-side `purchase` event (backlog 2.8). A client-side fire on the
// Razorpay redirect/handler flow undercounts — the browser can close or
// navigate away before that call completes. This webhook is server-to-
// server from Razorpay, so it fires reliably regardless of what the
// customer's browser does after paying.
//
// Setup (Razorpay Dashboard → Settings → Webhooks):
//   1. Add a webhook pointed at https://www.iwisglobal.com/api/webhooks/razorpay
//   2. Subscribe to the "payment.captured" event
//   3. Copy the webhook secret it shows you into RAZORPAY_WEBHOOK_SECRET
//      (Cloudflare Pages secret — separate from RAZORPAY_KEY_SECRET, which
//      is for the API, not webhooks)
// Also needs GA4_MEASUREMENT_ID + GA4_API_SECRET (GA4 Admin → Data Streams
// → your stream → Measurement Protocol API secrets) to actually send the
// event — without them this endpoint still verifies and acks webhooks
// (so Razorpay doesn't retry forever) but skips the GA4 call.

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = resolveEnv(locals);

  // Signature is computed over the exact raw request body — must read text
  // before any JSON parsing, or the bytes HMAC'd won't match what Razorpay
  // signed.
  const rawBody = await request.text();

  if (!env.RAZORPAY_WEBHOOK_SECRET) {
    console.error('razorpay webhook: RAZORPAY_WEBHOOK_SECRET not configured — cannot verify, acking anyway');
    return new Response('not configured', { status: 200 });
  }

  const signature = request.headers.get('x-razorpay-signature') ?? '';
  const expected = await hmacSha256Hex(env.RAZORPAY_WEBHOOK_SECRET, rawBody);
  if (!signature || !timingSafeEqual(signature, expected)) {
    console.error('razorpay webhook: signature mismatch');
    return new Response('invalid signature', { status: 400 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response('invalid JSON', { status: 400 });
  }

  if (payload.event !== 'payment.captured') {
    return new Response('ignored', { status: 200 });
  }

  const payment = payload.payload?.payment?.entity;
  if (!payment?.id) return new Response('missing payment entity', { status: 200 });

  // A custom Agra trip's deposit: book the trip here too, in case the guest's
  // browser closed before it could call /api/custom-trip/verify. Safe to repeat
  // (src/lib/customTripPayment.ts); a failure asks Razorpay to retry.
  if (env.DB) {
    let customTripId: string | undefined = payment.notes?.kind === 'custom' ? payment.notes.customTripId : undefined;
    if (!customTripId && !payment.notes?.tourId && payment.order_id) {
      try {
        const order = await fetchRazorpayOrder(env, payment.order_id);
        if (order.notes.kind === 'custom') customTripId = order.notes.customTripId;
      } catch (err) {
        console.error('razorpay webhook: could not read the order to check its kind', err);
      }
    }
    if (customTripId) {
      try {
        await finalizeCustomTrip(env, env.DB, {
          tripId: customTripId,
          orderId: payment.order_id,
          paymentId: payment.id,
          amountMinor: payment.amount,
          currency: payment.currency,
        });
      } catch (err) {
        console.error('razorpay webhook: custom trip could not be booked', err);
        return new Response('retry', { status: 500 });
      }
    }
  }

  const db = env.DB;
  if (db) {
    // Idempotency — Razorpay can (and does) redeliver the same event, and
    // a redelivery must never double-count a purchase in GA4.
    const already = await db.prepare(`SELECT 1 FROM analytics_events_sent WHERE payment_id = ?`).bind(payment.id).first();
    if (already) return new Response('already processed', { status: 200 });

    try {
      await db
        .prepare(`INSERT INTO analytics_events_sent (payment_id, sent_at) VALUES (?, ?)`)
        .bind(payment.id, new Date().toISOString())
        .run();
    } catch {
      // Lost a race with a concurrent delivery of the same event — that
      // delivery owns sending it, this one backs off.
      return new Response('already processed', { status: 200 });
    }
  }

  if (env.GA4_MEASUREMENT_ID && env.GA4_API_SECRET) {
    const notes = payment.notes ?? {};
    // Falls back to a random id (GA4's documented pattern for server hits
    // with no known client) if the buyer's browser never captured a _ga
    // cookie — still records the purchase, just not tied to their earlier
    // on-site browsing.
    const clientId = notes.gaClientId || crypto.randomUUID();

    try {
      await fetch(
        `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(env.GA4_MEASUREMENT_ID)}&api_secret=${encodeURIComponent(env.GA4_API_SECRET)}`,
        {
          method: 'POST',
          body: JSON.stringify({
            client_id: clientId,
            events: [
              {
                name: 'purchase',
                params: {
                  transaction_id: payment.id,
                  value: (payment.amount ?? 0) / 100,
                  currency: payment.currency,
                  items: [
                    {
                      item_id: notes.tourId ?? (notes.kind === 'custom' ? 'CUSTOM_AGRA' : undefined),
                      item_name: notes.tourId ?? (notes.kind === 'custom' ? 'CUSTOM_AGRA' : undefined),
                      quantity: Number(notes.travelers ?? 1),
                    },
                  ],
                },
              },
            ],
          }),
        }
      );
    } catch (err) {
      // Best-effort — the payment already succeeded; a failed analytics
      // call must never look like a webhook failure to Razorpay (which
      // would just retry a purchase that already happened and was recorded
      // in the idempotency table above).
      console.error('razorpay webhook: GA4 Measurement Protocol call failed', err);
    }
  }

  return new Response('ok', { status: 200 });
};
