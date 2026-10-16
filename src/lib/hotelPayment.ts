// Payment of a hotel booking (src/lib/hotelQuote.ts stores the quote):
//
//   order     the guest posts the names of everyone in the party and a contact;
//             the server checks them against the saved search, then opens a
//             Razorpay order for the saved sell total. Nothing price-related
//             comes from the browser.
//
// Opening an order is safe to repeat: a guest who closed the Razorpay window
// and pays again gets the same order back, never a second one.

import type { D1Like } from './db';
import { isHotelsEnabled } from './hotelData';
import type { SearchInput } from './hotelSearch';
import { validateContact } from './customTrip';
import { createHotelOrder } from './payments/razorpay';
import type { Locale } from './i18n';

export interface GuestRoom { names: { first: string; last: string; age?: number; type: 'AD' | 'CH' }[] }
export interface HotelContact { holderFirst: string; holderLast: string; email: string; phone: string }

export const QUOTE_LIFETIME_MS = 30 * 60 * 1000;

const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}' .-]{0,59}$/u;
const LOCALES: Locale[] = ['en', 'es', 'fr', 'de'];
const asLocale = (v: unknown): Locale => (LOCALES.includes(v as Locale) ? (v as Locale) : 'en');

const cleanName = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return NAME_RE.test(t) ? t : null;
};

export function validateHotelGuests(
  search: SearchInput,
  rooms: unknown,
  contact: unknown
): { ok: true; rooms: GuestRoom[]; contact: HotelContact } | { ok: false; fields: string[] } {
  const fields: string[] = [];
  const out: GuestRoom[] = [];

  if (!Array.isArray(rooms) || rooms.length !== search.rooms.length) {
    fields.push('rooms');
  } else {
    search.rooms.forEach((sr, i) => {
      const posted = rooms[i] && typeof rooms[i] === 'object' ? (rooms[i] as Record<string, unknown>).names : null;
      const expected = sr.adults + sr.childAges.length;
      if (!Array.isArray(posted) || posted.length !== expected) {
        fields.push(`rooms.${i}.names`);
        return;
      }
      const names: GuestRoom['names'] = [];
      posted.forEach((p, j) => {
        const rec = p && typeof p === 'object' ? (p as Record<string, unknown>) : {};
        const first = cleanName(rec.first);
        const last = cleanName(rec.last);
        if (first === null) fields.push(`rooms.${i}.names.${j}.first`);
        if (last === null) fields.push(`rooms.${i}.names.${j}.last`);
        const isChild = j >= sr.adults;
        names.push(
          isChild
            ? { first: first ?? '', last: last ?? '', age: sr.childAges[j - sr.adults], type: 'CH' }
            : { first: first ?? '', last: last ?? '', type: 'AD' }
        );
      });
      out.push({ names });
    });
  }

  const c = contact && typeof contact === 'object' ? (contact as Record<string, unknown>) : {};
  const holderFirst = cleanName(c.holderFirst);
  const holderLast = cleanName(c.holderLast);
  if (holderFirst === null) fields.push('holderFirst');
  if (holderLast === null) fields.push('holderLast');
  const email = typeof c.email === 'string' ? c.email.trim().slice(0, 201) : '';
  const phone = typeof c.phone === 'string' ? c.phone.trim().slice(0, 40) : '';
  const errs = validateContact({ name: 'xx', email, phone });
  if (errs.email) fields.push('email');
  if (errs.phone) fields.push('phone');

  if (fields.length > 0) return { ok: false, fields };
  return {
    ok: true,
    rooms: out,
    contact: { holderFirst: holderFirst!, holderLast: holderLast!, email, phone: phone.replace(/[\s().-]/g, '') },
  };
}

interface BookingRow {
  id: string;
  status: string;
  currency: 'INR' | 'USD';
  search_json: string;
  sell_total: number;
  order_id: string;
  created_at: string;
}

// POST /api/hotels/order
export async function handleHotelOrder(
  env: Record<string, any>,
  db: D1Like | undefined,
  raw: unknown,
  now: Date = new Date()
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!db) return { status: 503, body: { error: 'unavailable' } };
  if (!(await isHotelsEnabled(db))) return { status: 403, body: { error: 'not_available' } };

  const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const bookingId = typeof body.bookingId === 'string' ? body.bookingId : '';
  if (!bookingId || bookingId.length > 100) return { status: 400, body: { error: 'bad_request' } };

  const row = await db
    .prepare(`SELECT id, status, currency, search_json, sell_total, order_id, created_at FROM hotel_bookings WHERE id = ?`)
    .bind(bookingId)
    .first<BookingRow>();
  if (!row) return { status: 404, body: { error: 'not_found' } };
  if (row.status !== 'quoted' || now.getTime() - new Date(row.created_at).getTime() > QUOTE_LIFETIME_MS) {
    return { status: 409, body: { error: 'not_quoted' } };
  }

  let search: SearchInput;
  try {
    search = JSON.parse(row.search_json) as SearchInput;
  } catch {
    return { status: 409, body: { error: 'not_quoted' } };
  }
  const checked = validateHotelGuests(search, body.rooms, body.contact);
  if (!checked.ok) return { status: 400, body: { error: 'bad_details', fields: checked.fields } };

  const { contact } = checked;
  const holderName = `${contact.holderFirst} ${contact.holderLast}`;
  const guestsJson = JSON.stringify(checked.rooms);
  const locale = asLocale(body.locale);
  const stamp = now.toISOString();
  const amount = row.sell_total * 100;

  // The guest is paying again after closing the Razorpay window: keep the
  // order, refresh the details.
  if (row.order_id) {
    await db
      .prepare(`UPDATE hotel_bookings SET holder_name=?, email=?, phone=?, guests_json=?, locale=?, updated_at=? WHERE id=? AND status='quoted'`)
      .bind(holderName, contact.email, contact.phone, guestsJson, locale, stamp, row.id)
      .run();
    return { status: 200, body: reuse(env, row, amount) };
  }

  let order;
  try {
    order = await createHotelOrder(env, { amountMinor: amount, currency: row.currency, bookingId: row.id, receipt: row.id });
  } catch (e) {
    return { status: 502, body: { error: 'gateway', message: e instanceof Error ? e.message : 'Failed to create order' } };
  }

  const res = await db
    .prepare(
      `UPDATE hotel_bookings SET order_id=?, holder_name=?, email=?, phone=?, guests_json=?, locale=?, updated_at=? WHERE id=? AND status='quoted' AND order_id=''`
    )
    .bind(order.orderId, holderName, contact.email, contact.phone, guestsJson, locale, stamp, row.id)
    .run();
  if ((res as any)?.meta?.changes === 0) {
    // A concurrent request stored its order first; hand back that one.
    const again = await db.prepare(`SELECT order_id FROM hotel_bookings WHERE id = ? AND status = 'quoted'`).bind(row.id).first<{ order_id: string }>();
    if (!again?.order_id) return { status: 409, body: { error: 'not_quoted' } };
    return { status: 200, body: reuse(env, { ...row, order_id: again.order_id }, amount) };
  }
  return { status: 200, body: { bookingId: row.id, orderId: order.orderId, amount: order.amount, currency: order.currency, publicKey: order.publicKey } };
}

function reuse(env: Record<string, any>, row: BookingRow, amount: number): Record<string, unknown> {
  return { bookingId: row.id, orderId: row.order_id, amount, currency: row.currency, publicKey: env.PUBLIC_RAZORPAY_KEY_ID ?? env.RAZORPAY_KEY_ID };
}
