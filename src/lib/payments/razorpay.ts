import { computeTotal, computeDepositAmount, FOUNDING_GUEST_SLOT_CAP } from '../catalog';
import { resolveBookingDiscount, FOUNDING_GUEST_OFFER_ID } from '../offers';
import { todayIst } from '../availability';
import type { Currency } from '../currency';
import { getCatalogItem } from '../tours';
import { countBookings } from '../db';
import type { BookingRequest, OrderResult, VerifyRequest, VerifiedBooking, PaymentProvider } from './index';
import { packAttribution, packGuest, unpackAttribution, unpackGuest } from './orderNotes';

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

// --- Custom Agra trips (src/lib/customTripPayment.ts) -----------------------
// The same trust model as a tour booking, without the tour catalog: the amount
// is the deposit the server computed and saved, and the trip id rides in the
// order's notes so verification reads it back from Razorpay, never from the
// browser.

export async function createCustomTripOrder(
  env: Record<string, unknown>,
  input: { amountMinor: number; currency: 'INR' | 'USD'; tripId: string; receipt: string }
): Promise<OrderResult> {
  const { keyId, keySecret } = getCreds(env);
  if (!keyId || !keySecret) throw new Error('Payment gateway is misconfigured. Please contact support.');
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: input.amountMinor,
      currency: input.currency,
      receipt: input.receipt,
      notes: { kind: 'custom', customTripId: input.tripId },
    }),
  });
  if (!res.ok) {
    const err: any = await res.json().catch(() => null);
    const description = err?.error?.description;
    const isAuthFailure = res.status === 401 || /authentication failed/i.test(description ?? '');
    throw new Error(isAuthFailure ? 'Payment gateway is misconfigured. Please contact support.' : description || 'Failed to create order');
  }
  const order = await res.json();
  return { orderId: order.id, amount: order.amount, currency: order.currency, publicKey: keyId };
}

// --- Hotel bookings (src/lib/hotelPayment.ts) ------------------------------
// Same trust model: the amount is the sell total saved on the server, and the
// booking id rides in the order's notes.

export async function createHotelOrder(
  env: Record<string, unknown>,
  input: { amountMinor: number; currency: 'INR' | 'USD'; bookingId: string; receipt: string }
): Promise<OrderResult> {
  const { keyId, keySecret } = getCreds(env);
  if (!keyId || !keySecret) throw new Error('Payment gateway is misconfigured. Please contact support.');
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: input.amountMinor,
      currency: input.currency,
      receipt: input.receipt,
      notes: { kind: 'hotel', hotelBookingId: input.bookingId },
    }),
  });
  if (!res.ok) {
    const err: any = await res.json().catch(() => null);
    const description = err?.error?.description;
    const isAuthFailure = res.status === 401 || /authentication failed/i.test(description ?? '');
    throw new Error(isAuthFailure ? 'Payment gateway is misconfigured. Please contact support.' : description || 'Failed to create order');
  }
  const order = await res.json();
  return { orderId: order.id, amount: order.amount, currency: order.currency, publicKey: keyId };
}

// --- Private offers (src/lib/offerPayment.ts) ------------------------------
// Same trust model: the amount is what the server computed from the stored
// offer and its stored payments, in the offer's currency, and the payment row
// id rides in the order's notes. Razorpay's own error description is passed on
// so a refused currency (EUR) is diagnosable.

export async function createOfferOrder(
  env: Record<string, unknown>,
  input: { amountMinor: number; currency: 'EUR' | 'USD' | 'INR'; offerPaymentId: string; receipt: string }
): Promise<OrderResult> {
  const { keyId, keySecret } = getCreds(env);
  if (!keyId || !keySecret) throw new Error('Payment gateway is misconfigured. Please contact support.');
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: input.amountMinor,
      currency: input.currency,
      receipt: input.receipt,
      notes: { kind: 'offer', offerPaymentId: input.offerPaymentId },
    }),
  });
  if (!res.ok) {
    const err: any = await res.json().catch(() => null);
    const description = err?.error?.description;
    const isAuthFailure = res.status === 401 || /authentication failed/i.test(description ?? '');
    throw new Error(isAuthFailure ? 'Payment gateway is misconfigured. Please contact support.' : description || 'Failed to create order');
  }
  const order = await res.json();
  return { orderId: order.id, amount: order.amount, currency: order.currency, publicKey: keyId };
}

// --- Balance of a tour booking (src/lib/balancePayment.ts) -----------------
// Same trust model: the amount is the balance the server stored on the link and
// re-checked against the booking, and the link id rides in the order's notes.

export async function createBalanceOrder(
  env: Record<string, unknown>,
  input: { amountMinor: number; currency: 'INR' | 'USD'; linkId: string; receipt: string }
): Promise<OrderResult> {
  const { keyId, keySecret } = getCreds(env);
  if (!keyId || !keySecret) throw new Error('Payment gateway is misconfigured. Please contact support.');
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: input.amountMinor,
      currency: input.currency,
      receipt: input.receipt,
      notes: { kind: 'balance', balanceLinkId: input.linkId },
    }),
  });
  if (!res.ok) {
    const err: any = await res.json().catch(() => null);
    const description = err?.error?.description;
    const isAuthFailure = res.status === 401 || /authentication failed/i.test(description ?? '');
    throw new Error(isAuthFailure ? 'Payment gateway is misconfigured. Please contact support.' : description || 'Failed to create order');
  }
  const order = await res.json();
  return { orderId: order.id, amount: order.amount, currency: order.currency, publicKey: keyId };
}

// Refunds part or all of a payment; the amount is in minor units (paise/cents).
export async function refundPaymentAmount(env: Record<string, unknown>, paymentId: string, amountMinor: number): Promise<void> {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new Error('Invalid refund amount');
  const { keyId, keySecret } = getCreds(env);
  if (!keyId || !keySecret) throw new Error('Payment gateway is misconfigured. Please contact support.');

  const auth = btoa(`${keyId}:${keySecret}`);
  // A refund that hangs would leave the booking claimed as failed with no
  // refund; time out and take the normal refund-failure path instead.
  const res = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}/refund`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: amountMinor }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const err: any = await res.json().catch(() => null);
    throw new Error(err?.error?.description || 'Refund failed');
  }
}

// The order as Razorpay holds it: the trusted source for its notes and amount.
export async function fetchRazorpayOrder(env: Record<string, unknown>, orderId: string): Promise<{ amount: number; currency: string; notes: Record<string, string> }> {
  const { keyId, keySecret } = getCreds(env);
  if (!keyId || !keySecret) throw new Error('Server configuration error');
  const res = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}` },
  });
  if (!res.ok) throw new Error('Could not verify order');
  const order = await res.json();
  return { amount: Number(order.amount), currency: String(order.currency), notes: order.notes ?? {} };
}

// A tour booking as its Razorpay order describes it. Used by the browser's verify call and by the payment webhook,
// so both record exactly the same thing: the amount Razorpay charged, and the totals and discount fixed when the
// order was created (never re-priced from today's catalog).
export function bookingFromOrder(paymentId: string, orderId: string, order: { amount: number; notes: Record<string, string> }): VerifiedBooking {
  const notes = order.notes ?? {};
  return {
    paymentId,
    orderId,
    tourId: notes.tourId,
    date: notes.date,
    travelers: Number(notes.travelers ?? 1),
    addOnIds: notes.addOnIds ? String(notes.addOnIds).split(',').filter(Boolean) : [],
    currency: notes.currency === 'USD' ? 'USD' : 'INR',
    totalAmount: notes.totalAmount != null ? Number(notes.totalAmount) : Number(order.amount),
    paymentType: notes.paymentType === 'deposit' ? 'deposit' : 'full',
    foundingGuestDiscount: notes.foundingGuestDiscount === 'true',
    discount: notes.discount != null ? Number(notes.discount) : undefined,
    offerId: notes.offerId || undefined,
    discountLabel: notes.discountLabel || undefined,
    amountCharged: Number(order.amount),
    guest: unpackGuest(notes.guest),
    attribution: unpackAttribution(notes.attr),
  };
}

// True when Razorpay's checkout signature for this order and payment is valid.
export async function verifyRazorpaySignature(env: Record<string, unknown>, orderId: string, paymentId: string, signature: string): Promise<boolean> {
  const { keySecret } = getCreds(env);
  if (!keySecret) throw new Error('Server configuration error');
  return (await hmacSha256Hex(keySecret, `${orderId}|${paymentId}`)) === signature;
}

export const razorpayProvider: PaymentProvider = {
  async createOrder(req: BookingRequest, env: Record<string, unknown>): Promise<OrderResult> {
    const item = await getCatalogItem(env.DB as any, req.tourId, { onlyPublished: true, currency: req.currency });
    if (!item) throw new Error('Unknown or missing tour');
    if (!req.travelers || req.travelers < 1) throw new Error('At least one traveler is required');

    // The amount is NEVER taken from the client — it is derived from the
    // server-side catalog using the requested tourId, traveler count, and
    // add-ons. This prevents a booking being paid for at an arbitrary amount.
    const rawTotalMajorUnits = computeTotal(item, req.travelers, req.addOnIds ?? []);
    // Backlog 1.1 — Founding Guest offer: 15% off, no code, first 25
    // confirmed bookings site-wide. Decided once, here, and carried in the
    // trusted order notes below so verifyPayment applies the identical
    // discount rather than re-checking a count that may have moved on.
    const foundingGuestDiscount = env.DB ? (await countBookings(env.DB as any)) < FOUNDING_GUEST_SLOT_CAP : false;
    // One discount per booking — the biggest of the Founding Guest Offer,
    // any automatic offer and the entered coupon (src/lib/offers.ts).
    // Throws CouponError for an unusable code rather than charging a price
    // the customer wasn't shown.
    const discount = env.DB
      ? await resolveBookingDiscount(
          env.DB as any,
          { tourId: req.tourId, travelDate: req.date, travelers: req.travelers, currency: item.currency as Currency, today: todayIst() },
          rawTotalMajorUnits,
          foundingGuestDiscount,
          req.couponCode
        )
      : null;
    const totalMajorUnits = rawTotalMajorUnits - (discount?.amount ?? 0);
    const paymentType: 'full' | 'deposit' = req.paymentType === 'deposit' ? 'deposit' : 'full';
    // Backlog 0.4 — a deposit charges 25% of the total now; the rest is
    // paid on pickup, outside this payment flow entirely. The full total is
    // still recorded in notes below, so verifyPayment (and the balance-due
    // figure shown to the customer/admin) always has the real total on hand.
    const chargeMajorUnits = paymentType === 'deposit' ? computeDepositAmount(totalMajorUnits) : totalMajorUnits;
    const amount = Math.round(chargeMajorUnits * 100); // Razorpay wants the smallest currency subunit

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
          totalAmount: String(Math.round(totalMajorUnits * 100)),
          paymentType,
          foundingGuestDiscount: String(discount?.offerId === FOUNDING_GUEST_OFFER_ID),
          discount: String(discount?.amount ?? 0),
          ...(discount ? { offerId: discount.offerId, discountLabel: discount.label } : {}),
          ...(req.gaClientId ? { gaClientId: req.gaClientId } : {}),
          // So the webhook can create the booking if the browser never comes back (one key each, see orderNotes.ts).
          guest: packGuest(req.guest),
          attr: packAttribution(req.attribution),
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
    const order = await fetchRazorpayOrder(env, req.orderId);
    return bookingFromOrder(req.paymentId, req.orderId, order);
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
