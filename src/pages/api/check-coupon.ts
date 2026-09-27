import type { APIRoute } from 'astro';
import { resolveEnv } from '../../lib/env';
import { findCoupon, CouponError } from '../../lib/offers';
import { todayIst } from '../../lib/availability';

export const prerender = false;

// Checks a coupon code the customer typed at checkout, for this tour on
// today's date, and returns the offer so the booking widget can show the
// discount live (travel-date and group-size conditions are checked there
// against the actual booking). Display only: create-order re-checks the code
// and decides the charge itself.
export const POST: APIRoute = async ({ request, locals }) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  try {
    const { code, tourId } = await request.json();
    if (typeof code !== 'string' || typeof tourId !== 'string' || code.length > 40) return json({ error: "That code isn't valid." }, 400);
    const db = resolveEnv(locals).DB;
    if (!db) return json({ error: 'Coupons are unavailable right now.' }, 503);
    const offer = await findCoupon(db, code, tourId, todayIst());
    return json({ offer });
  } catch (err) {
    if (err instanceof CouponError) return json({ error: err.message }, 400);
    console.error('check-coupon error:', err);
    return json({ error: 'Could not check that code. Please try again.' }, 500);
  }
};
