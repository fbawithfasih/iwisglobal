import type { APIRoute } from 'astro';
import { razorpayProvider } from '../../lib/payments/razorpay';
import { travelersBookedOn, MAX_TRAVELERS_PER_DATE } from '../../lib/db';
import { resolveEnv } from '../../lib/env';
import { isBookableDate, isValidDateString, isTajClosedStart, tajDayOffset, FRIDAY_CLOSED_MESSAGE, TAJ_DAY_CLOSED_MESSAGE } from '../../lib/availability';
import { getTourById } from '../../lib/tours';
import { attributionFromBody } from '../../lib/payments/orderNotes';
import { metaContextFromRequest } from '../../lib/metaCapi';
import { resolveLocale } from '../../lib/i18n';
import { fmt } from '../../i18n/fmt';
import { OFFER_TIMER_COOKIE, timerSecret, verifyTimer } from '../../lib/offerTimer';
import { isNightViewingTour, isNightViewingDate, NIGHT_VIEWING_DATE_MESSAGE } from '../../lib/nightViewing';

export const prerender = false;

// This is a fast-fail UX check only, so an obviously-sold-out date doesn't
// even reach checkout. It's still subject to a TOCTOU race against other
// concurrent orders — the authoritative, race-proof enforcement happens at
// insertVerifiedBooking() in verify-payment.ts, which refunds the payment if
// the date sold out between order creation and payment completion.

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  try {
    const { tourId, date, travelers, addOnIds, currency, receipt, gaClientId, paymentType, couponCode, guest, attribution } = await request.json();

    if (!tourId || !date || !Number.isInteger(travelers) || travelers < 1) {
      return new Response(JSON.stringify({ error: 'Missing tourId, date, or travelers' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const env = resolveEnv(locals);
    const db = env.DB;

    // Re-checks the same rule the date picker's `min` attribute expresses
    // client-side — a raw API call can't book a past date or a same-day
    // slot after the 9 PM IST cutoff, or a trip that reaches the Taj Mahal
    // (closed Fridays) on a Friday.
    const tour = db ? await getTourById(db, String(tourId)) : null;
    const tajOffset = tour ? tajDayOffset(tour.itinerary) : 0;
    if (typeof date !== 'string' || !isBookableDate(date, new Date(), tajOffset)) {
      const closed = typeof date === 'string' && isValidDateString(date) && isTajClosedStart(date, tajOffset);
      const error = closed ? (tajOffset > 0 ? fmt(TAJ_DAY_CLOSED_MESSAGE, { n: tajOffset + 1 }) : FRIDAY_CLOSED_MESSAGE) : 'Please choose a valid, bookable travel date.';
      return new Response(JSON.stringify({ error }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Night-viewing tours run only on the ASI's night-viewing nights.
    if (isNightViewingTour(tourId) && !isNightViewingDate(date)) {
      return new Response(JSON.stringify({ error: NIGHT_VIEWING_DATE_MESSAGE }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (db) {
      const alreadyBooked = await travelersBookedOn(db, tourId, date);
      if (alreadyBooked + travelers > MAX_TRAVELERS_PER_DATE) {
        return new Response(
          JSON.stringify({ error: 'This date is fully booked. Please choose another date.' }),
          { status: 409, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    const order = await razorpayProvider.createOrder(
      {
        tourId,
        date,
        travelers,
        addOnIds: addOnIds ?? [],
        currency: currency === 'USD' ? 'USD' : 'INR',
        receipt,
        gaClientId: typeof gaClientId === 'string' ? gaClientId : undefined,
        paymentType: paymentType === 'deposit' ? 'deposit' : 'full',
        couponCode: typeof couponCode === 'string' ? couponCode.slice(0, 40) : undefined,
        // A countdown offer counts from the signed cookie only, never from anything the browser sends in the body.
        offerTimerStartedAt: await verifyTimer(timerSecret(env), cookies.get(OFFER_TIMER_COOKIE)?.value),
        // Kept with the order so the payment webhook can still create the booking if the browser never returns.
        guest: {
          name: typeof guest?.name === 'string' ? guest.name : '',
          email: typeof guest?.email === 'string' ? guest.email : '',
          phone: typeof guest?.phone === 'string' ? guest.phone : '',
          locale: resolveLocale(new URL(request.url).searchParams, cookies.get('lang')?.value),
        },
        attribution: attributionFromBody(attribution),
        meta: metaContextFromRequest(request),
      },
      env
    );

    return new Response(JSON.stringify(order), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    const msg = error?.message || String(error);
    const status = /misconfigured|configuration/i.test(msg) ? 500 : 400;
    return new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
