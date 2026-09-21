import { computeTotal } from '../catalog';
import { getCatalogItem } from '../tours';
import type { BookingRequest, OrderResult, VerifyRequest, VerifiedBooking, PaymentProvider } from './index';

function getCreds(env: Record<string, unknown>) {
  const keyId = (env.PUBLIC_RAZORPAY_KEY_ID ?? env.RAZORPAY_KEY_ID) as string | undefined;
  const keySecret = env.RAZORPAY_KEY_SECRET as string | undefined;
  return { keyId, keySecret };
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export const razorpayProvider: PaymentProvider = {
  async createOrder(req: BookingRequest, env: Record<string, unknown>): Promise<OrderResult> {
    const item = await getCatalogItem(env.DB as any, req.tourId, { onlyPublished: true, currency: req.currency });
    if (!item) throw new Error('Unknown or missing tour');
    if (!req.travelers || req.travelers < 1) throw new Error('At least one traveler is required');

    // The amount is NEVER taken from the client — it is derived from the
    // server-side catalog using the requested tourId, traveler count, and
    // add-ons. This prevents a booking being paid for at an arbitrary amount.
    const totalMajorUnits = computeTotal(item, req.travelers, req.addOnIds ?? []);
    const amount = Math.round(totalMajorUnits * 100); // Razorpay wants the smallest currency subunit

    const { keyId, keySecret } = getCreds(env);
    if (!keyId || !keySecret) throw new Error('Payment gateway is misconfigured. Please contact support.');

    const auth = btoa(`${keyId}:${keySecret}`);
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount,
        currency: item.currency,
        receipt: req.receipt || `rcpt_${Date.now()}`,
        // Persist the booking details server-side so verifyPayment can read
        // them back from the trusted order rather than trusting the client.
        // gaClientId rides along the same way so the webhook (backlog 2.8)
        // can read it back too, with no DB round-trip needed for either.
        notes: {
          tourId: req.tourId,
          date: req.date,
          travelers: String(req.travelers),
          addOnIds: (req.addOnIds ?? []).join(','),
          currency: item.currency,
          ...(req.gaClientId ? { gaClientId: req.gaClientId } : {}),
        },
      }),
    });

    if (!res.ok) {
      const err: any = await res.json().catch(() => null);
      const description = err?.error?.description;
      const isAuthFailure = res.status === 401 || /authentication failed/i.test(description ?? '');
      throw new Error(
        isAuthFailure ? 'Payment gateway is misconfigured. Please contact support.' : description || 'Failed to create order'
      );
    }

    const order = await res.json();
    return {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      // Return the key that actually created this order so the browser opens
      // the checkout widget with the same key/mode — PUBLIC_* env vars are
      // inlined at build time and can drift from the Cloudflare runtime
      // binding read here, so the client must not read its own copy.
      publicKey: keyId,
    };
  },

  async verifyPayment(req: VerifyRequest, env: Record<string, unknown>): Promise<VerifiedBooking> {
    const { keyId, keySecret } = getCreds(env);
    if (!keySecret) throw new Error('Server configuration error');

    const expectedSignature = await hmacSha256Hex(keySecret, `${req.orderId}|${req.paymentId}`);
    if (expectedSignature !== req.signature) {
      throw new Error('Payment signature verification failed');
    }

    // Resolve booking details from the TRUSTED order on Razorpay's side —
    // never from the client request — so a caller can't pay for one tour
    // and claim a different (more expensive) itinerary.
    if (!keyId) throw new Error('Server configuration error');
    const auth = btoa(`${keyId}:${keySecret}`);
    const orderRes = await fetch(`https://api.razorpay.com/v1/orders/${req.orderId}`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!orderRes.ok) throw new Error('Could not verify order');
    const order = await orderRes.json();
    const notes = order?.notes ?? {};

    return {
      paymentId: req.paymentId,
      orderId: req.orderId,
      tourId: notes.tourId,
      date: notes.date,
      travelers: Number(notes.travelers ?? 1),
      addOnIds: notes.addOnIds ? String(notes.addOnIds).split(',').filter(Boolean) : [],
      currency: notes.currency === 'USD' ? 'USD' : 'INR',
    };
  },

  async refundPayment(paymentId: string, env: Record<string, unknown>): Promise<void> {
    const { keyId, keySecret } = getCreds(env);
    if (!keyId || !keySecret) throw new Error('Payment gateway is misconfigured. Please contact support.');

    const auth = btoa(`${keyId}:${keySecret}`);
    const res = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}/refund`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}), // no amount specified = full refund
    });

    if (!res.ok) {
      const err: any = await res.json().catch(() => null);
      throw new Error(err?.error?.description || 'Refund failed');
    }
  },
};
