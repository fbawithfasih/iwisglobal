import type { APIRoute } from 'astro';
import { razorpayProvider } from '../../lib/payments/razorpay';
import { travelersBookedOn } from '../../lib/db';
import { resolveEnv } from '../../lib/env';

export const prerender = false;

// Same-day Agra tour: one vehicle/guide slot per date. Keep this simple cap
// rather than a full availability calendar for Phase 1.
const MAX_TRAVELERS_PER_DATE = 12;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const { tourId, date, travelers, addOnIds, receipt } = await request.json();

    if (!tourId || !date || !travelers) {
      return new Response(JSON.stringify({ error: 'Missing tourId, date, or travelers' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const env = resolveEnv(locals);
    const db = env.DB;

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
      { tourId, date, travelers, addOnIds: addOnIds ?? [], receipt },
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
