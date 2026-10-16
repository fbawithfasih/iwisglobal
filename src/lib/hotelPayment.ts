// Payment of a hotel booking (src/lib/hotelQuote.ts stores the quote):
//
//   order     the guest posts the names of everyone in the party and a contact;
//             the server checks them against the saved search, then opens a
//             Razorpay order for the saved sell total. Nothing price-related
//             comes from the browser.
//
//   verify    after the guest pays (the browser's verify call or Razorpay's
//             webhook, whichever comes first), check the payment against the
//             saved booking, claim it, book it with Hotelbeds, and on any
//             failure reconcile with Hotelbeds before refunding in full.
//
// Opening an order is safe to repeat: a guest who closed the Razorpay window
// and pays again gets the same order back, never a second one. Finalising is
// safe to repeat and to race: only the caller that wins the atomic claim ever
// asks Hotelbeds to book, and a booking is only ever posted once per id.

import type { D1Like } from './db';
import { isHotelsEnabled } from './hotelData';
import type { SearchInput } from './hotelSearch';
import { validateContact } from './customTrip';
import { createHotelOrder, fetchRazorpayOrder, refundPaymentAmount, verifyRazorpaySignature } from './payments/razorpay';
import { bookHotel, cancelHotelBooking, hbConfig, listHotelBookingsByReference, type HbBookingRequest, type HbConfig } from './hotelbeds';
import { sendHotelAlertEmail } from './email';
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
  // An unreadable created_at gives NaN, which fails this check (closed).
  const age = now.getTime() - new Date(row.created_at).getTime();
  if (row.status !== 'quoted' || !(age <= QUOTE_LIFETIME_MS)) {
    return { status: 409, body: { error: 'not_quoted' } };
  }

  let search: SearchInput;
  try {
    search = JSON.parse(row.search_json) as SearchInput;
  } catch {
    return { status: 409, body: { error: 'not_quoted' } };
  }
  // The quote holds one rateKey, so only a party of identical rooms can be booked.
  if (!isUniformParty(search)) return { status: 409, body: { error: 'unsupported_party' } };
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
  if ((res as any)?.meta?.changes !== 1) {
    // A concurrent request stored its order first; hand back that one.
    const again = await db.prepare(`SELECT order_id FROM hotel_bookings WHERE id = ? AND status = 'quoted'`).bind(row.id).first<{ order_id: string }>();
    if (!again?.order_id) return { status: 409, body: { error: 'not_quoted' } };
    return { status: 200, body: reuse(env, { ...row, order_id: again.order_id }, amount) };
  }
  return { status: 200, body: { bookingId: row.id, orderId: order.orderId, amount: order.amount, currency: order.currency, publicKey: order.publicKey } };
}

// True when every room has the same number of adults and the same child ages.
export function isUniformParty(search: SearchInput): boolean {
  if (!search || !Array.isArray(search.rooms) || search.rooms.length === 0) return false;
  const key = (r: SearchInput['rooms'][number]) => `${r.adults}|${[...(r.childAges ?? [])].sort((a, b) => a - b).join(',')}`;
  const first = key(search.rooms[0]);
  return search.rooms.every((r) => key(r) === first);
}

function reuse(env: Record<string, any>, row: BookingRow, amount: number): Record<string, unknown> {
  return { bookingId: row.id, orderId: row.order_id, amount, currency: row.currency, publicKey: env.PUBLIC_RAZORPAY_KEY_ID ?? env.RAZORPAY_KEY_ID };
}

// ---------------------------------------------------------------------------
// Part 2: verify, book, reconcile, refund.

// Hotelbeds documents the booking clientReference as "string [ 1 .. 20 ]
// characters". Our ids are hb_<uuid> (39 characters), so Hotelbeds gets the
// first 20; every reconcile lookup uses the same value.
export const HB_CLIENT_REFERENCE_MAX = 20;
export function hotelClientReference(id: string): string {
  return id.slice(0, HB_CLIENT_REFERENCE_MAX);
}

// A row left 'paid' with no Hotelbeds reference for longer than this belongs to
// a request that died (the booking call times out at 70 s, the lookup at 15 s).
export const STUCK_PAID_MS = 90_000;

export type HotelFinalizeOutcome = 'booked' | 'duplicate' | 'unknown' | 'mismatch' | 'failed_refunded' | 'failed_refund_error' | 'unresolved';

interface PaidBookingRow {
  id: string;
  status: string;
  currency: string;
  sell_total: number;
  order_id: string;
  payment_id: string;
  hb_reference: string;
  holder_name: string;
  guests_json: string;
  selected_json: string;
  created_at: string;
  updated_at: string;
}

interface Supplier { name: string; vat: string; code: string }

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const supplierOf = (inv: any): Supplier => ({ name: str(inv?.company) || str(inv?.name), vat: str(inv?.registrationNumber), code: str(inv?.code) });
const changed = (res: unknown): boolean => (res as any)?.meta?.changes === 1;
const dayOffset = (d: Date, days: number): string => new Date(d.getTime() + days * 86_400_000).toISOString().slice(0, 10);

// Never throws: an alert problem must not change what happens to the money.
async function alertOwner(env: Record<string, any>, id: string, paymentId: string, reason: string): Promise<void> {
  try {
    console.error('hotel booking needs attention', id, paymentId, reason);
    await sendHotelAlertEmail(env, `Hotel booking needs attention: ${id}`, [`Booking: ${id}`, `Payment: ${paymentId}`, `Reason: ${reason}`].join('\n'));
  } catch {
    // sendHotelAlertEmail never throws; this is belt and braces.
  }
}

// Voucher emails come in Task 13. Kept isolated and never allowed to throw.
async function sendHotelEmails(_env: Record<string, any>, row: { id: string }): Promise<void> {
  try {
    console.info('hotel booking confirmed', row.id);
  } catch {
    // Never let an email problem touch a confirmed booking.
  }
}

// The Hotelbeds booking request: the holder from the contact, and ONE rooms
// entry (the quote holds one rateKey for a party of identical rooms) carrying
// every guest, roomId = 1-based room index, adults then children with ages.
export function buildHotelBookingRequest(row: Pick<PaidBookingRow, 'id' | 'holder_name' | 'guests_json' | 'selected_json'>): HbBookingRequest | null {
  let guests: GuestRoom[];
  let selected: any;
  try {
    guests = JSON.parse(row.guests_json);
    selected = JSON.parse(row.selected_json);
  } catch {
    return null;
  }
  const rateKey = selected?.bookRateKey;
  if (typeof rateKey !== 'string' || !rateKey || !Array.isArray(guests) || guests.length === 0) return null;
  const paxes: HbBookingRequest['rooms'][number]['paxes'] = [];
  for (let i = 0; i < guests.length; i++) {
    const names = Array.isArray(guests[i]?.names) ? guests[i].names : [];
    if (names.length === 0) return null;
    const ordered = [...names.filter((g) => g.type === 'AD'), ...names.filter((g) => g.type === 'CH')];
    for (const g of ordered) {
      if (!g.first || !g.last) return null;
      if (g.type === 'CH') {
        if (typeof g.age !== 'number') return null;
        paxes.push({ roomId: i + 1, type: 'CH', name: g.first, surname: g.last, age: g.age });
      } else {
        paxes.push({ roomId: i + 1, type: 'AD', name: g.first, surname: g.last });
      }
    }
  }
  const holder = String(row.holder_name ?? '').trim();
  const space = holder.indexOf(' ');
  const name = space > 0 ? holder.slice(0, space) : holder;
  const surname = space > 0 ? holder.slice(space + 1).trim() : '';
  if (!name || !surname) return null;
  return { clientReference: hotelClientReference(row.id), holder: { name, surname }, rooms: [{ rateKey, paxes }] };
}

// What Hotelbeds holds under our clientReference. 'found' only for a CONFIRMED
// booking with exactly our reference; 'none' when the lookup answered and has
// none; 'error' when the lookup could not be made or read.
async function reconcile(
  cfg: HbConfig,
  row: PaidBookingRow,
  now: Date
): Promise<{ kind: 'found'; reference: string; supplier: Supplier } | { kind: 'none' } | { kind: 'error' }> {
  const ref = hotelClientReference(row.id);
  const created = new Date(row.created_at);
  const start = Number.isNaN(created.getTime()) ? dayOffset(now, -2) : dayOffset(created, -1);
  try {
    const res = await listHotelBookingsByReference(cfg, ref, start, dayOffset(now, 1));
    const list = res.json?.bookings?.bookings;
    if (res.status !== 200 || !Array.isArray(list)) return { kind: 'error' };
    const hits = list.filter((b: any) => b && b.clientReference === ref && b.status === 'CONFIRMED' && typeof b.reference === 'string' && b.reference.trim());
    if (hits.length === 0) return { kind: 'none' };
    return { kind: 'found', reference: hits[0].reference.trim(), supplier: supplierOf(hits[0].invoiceCompany) };
  } catch {
    return { kind: 'error' };
  }
}

// Records a paid hotel booking and books it with Hotelbeds. Every path ends
// with a confirmed booking, a full refund, or (when Hotelbeds cannot tell us
// what happened) the row left 'paid' with the owner alerted, so a retry can
// reconcile it later.
export async function finalizeHotelBooking(
  env: Record<string, any>,
  db: D1Like,
  paid: { bookingId: string; orderId: string; paymentId: string; amountMinor: number; currency: string },
  clock: () => Date = () => new Date()
): Promise<HotelFinalizeOutcome> {
  const load = () =>
    db
      .prepare(
        `SELECT id, status, currency, sell_total, order_id, payment_id, hb_reference, holder_name, guests_json, selected_json, created_at, updated_at FROM hotel_bookings WHERE id = ?`
      )
      .bind(paid.bookingId)
      .first<PaidBookingRow>();
  const row = await load();
  if (!row) return 'unknown';
  if (!row.order_id || row.order_id !== paid.orderId || row.currency !== paid.currency || row.sell_total * 100 !== paid.amountMinor) {
    // Money was captured that does not match this booking: a person decides.
    await alertOwner(env, paid.bookingId, paid.paymentId, `payment does not match the booking (order ${paid.orderId}); nothing changed, not refunded`);
    return 'mismatch';
  }

  // A different payment than the one this booking already holds (a second
  // payment on the same order, or a late one on a settled booking): money with
  // no booking behind it. Alert; never refund or change state automatically.
  const strayPayment = async (current: { payment_id: string; status: string } | null): Promise<HotelFinalizeOutcome> => {
    if (current && current.payment_id && current.payment_id !== paid.paymentId) {
      await alertOwner(env, row.id, paid.paymentId, `a second payment arrived for this booking (status ${current.status}, booking holds payment ${current.payment_id}); not refunded`);
    }
    return 'duplicate';
  };

  const now = clock();
  const stamp = now.toISOString();
  let retry = false;
  if (row.status === 'quoted') {
    const claim = await db
      .prepare(`UPDATE hotel_bookings SET status='paid', payment_id=?, updated_at=? WHERE id=? AND status='quoted'`)
      .bind(paid.paymentId, stamp, row.id)
      .run();
    if (!changed(claim)) return strayPayment(await db.prepare(`SELECT payment_id, status FROM hotel_bookings WHERE id = ?`).bind(row.id).first<{ payment_id: string; status: string }>());
  } else if (row.status === 'paid' && row.hb_reference === '' && row.payment_id === paid.paymentId) {
    // A request that claimed this booking died before finishing. Take it over
    // once (the updated_at compare stops two retries both winning) and only
    // reconcile: the booking is never posted to Hotelbeds a second time.
    const age = now.getTime() - new Date(row.updated_at).getTime();
    if (!(age > STUCK_PAID_MS)) return 'duplicate';
    const reclaim = await db
      .prepare(`UPDATE hotel_bookings SET updated_at=? WHERE id=? AND status='paid' AND hb_reference='' AND updated_at=?`)
      .bind(stamp, row.id, row.updated_at)
      .run();
    if (!changed(reclaim)) return 'duplicate';
    retry = true;
  } else {
    return strayPayment(row);
  }

  const cfg = hbConfig(env);
  if (!cfg) {
    await alertOwner(env, row.id, paid.paymentId, 'could not confirm with Hotelbeds (not configured)');
    return 'unresolved';
  }

  // Book (first attempt only). A 4xx answer is a definite rejection; a
  // timeout, network error, 5xx or an answer without a reference is ambiguous:
  // Hotelbeds may still commit the booking after we gave up.
  let ambiguous = false;
  if (!retry) {
    const req = buildHotelBookingRequest(row);
    if (req) {
      try {
        const res = await bookHotel(cfg, req);
        const reference = res.json?.booking?.reference;
        if (res.status === 200 && typeof reference === 'string' && reference.trim()) {
          return markBooked(env, db, cfg, row, paid.paymentId, reference.trim(), supplierOf(res.json.booking.invoiceCompany));
        }
        ambiguous = !(res.status >= 400 && res.status <= 499);
        console.error('hotel booking not confirmed by Hotelbeds', row.id, res.status);
      } catch (e) {
        ambiguous = true;
        console.error('hotel booking call failed', row.id, e instanceof Error ? e.name : 'error');
      }
    } else {
      // Nothing was sent to Hotelbeds, so nothing can be committed there.
      console.error('hotel booking request could not be built', row.id);
    }
  }

  // Ask Hotelbeds what it holds before deciding anything.
  const found = await reconcile(cfg, row, clock());
  if (found.kind === 'found') return markBooked(env, db, cfg, row, paid.paymentId, found.reference, found.supplier);
  if (found.kind === 'error') {
    await alertOwner(env, row.id, paid.paymentId, 'could not confirm with Hotelbeds; payment held, not refunded');
  }
  if (found.kind === 'error' || ambiguous) {
    if (ambiguous) {
      // Keep the money and look again later: restart the 90-second takeover
      // window from now (only if nobody else has touched the row since our claim).
      await db
        .prepare(`UPDATE hotel_bookings SET updated_at=? WHERE id=? AND status='paid' AND hb_reference='' AND updated_at=?`)
        .bind(clock().toISOString(), row.id, stamp)
        .run();
    }
    return 'unresolved';
  }

  // Hotelbeds has no booking: refund in full. Claim first so only one caller refunds.
  const fail = await db
    .prepare(`UPDATE hotel_bookings SET status='failed', updated_at=? WHERE id=? AND status='paid'`)
    .bind(new Date().toISOString(), row.id)
    .run();
  if (!changed(fail)) return 'duplicate';
  try {
    await refundPaymentAmount(env, paid.paymentId, row.sell_total * 100);
  } catch (e) {
    // The alert and the status restore are independent: either may fail
    // without stopping the other, and neither throws out of here.
    await alertOwner(env, row.id, paid.paymentId, `not booked with Hotelbeds and the refund failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    try {
      await db
        .prepare(`UPDATE hotel_bookings SET status='paid', updated_at=? WHERE id=? AND status='failed'`)
        .bind(clock().toISOString(), row.id)
        .run();
    } catch {
      console.error('hotel booking: could not restore paid after a failed refund', row.id);
    }
    return 'failed_refund_error';
  }
  await db.prepare(`UPDATE hotel_bookings SET refunded=?, updated_at=? WHERE id=?`).bind(row.sell_total, clock().toISOString(), row.id).run();
  return 'failed_refunded';
}

async function markBooked(
  env: Record<string, any>,
  db: D1Like,
  cfg: HbConfig,
  row: PaidBookingRow,
  paymentId: string,
  reference: string,
  supplier: Supplier
): Promise<HotelFinalizeOutcome> {
  const res = await db
    .prepare(`UPDATE hotel_bookings SET status='booked', hb_reference=?, supplier_json=?, updated_at=? WHERE id=? AND status='paid'`)
    .bind(reference, JSON.stringify(supplier), new Date().toISOString(), row.id)
    .run();
  if (changed(res)) {
    await sendHotelEmails(env, row);
    return 'booked';
  }
  // The row moved on while Hotelbeds answered. If another caller already
  // recorded this same booking, nothing to do; otherwise this Hotelbeds booking
  // has no payment behind it (the row was refunded): cancel it and tell the owner.
  const now = await db.prepare(`SELECT status, hb_reference FROM hotel_bookings WHERE id = ?`).bind(row.id).first<{ status: string; hb_reference: string }>();
  if (now?.status === 'booked' && now.hb_reference === reference) return 'duplicate';
  let cancelled = false;
  try {
    const c = await cancelHotelBooking(cfg, reference);
    cancelled = c.status === 200;
  } catch {
    // Reported below.
  }
  await alertOwner(env, row.id, paymentId, `Hotelbeds booking ${reference} confirmed after the booking was ${now?.status ?? 'missing'}; cancellation ${cancelled ? 'sent' : 'FAILED, cancel it by hand'}`);
  return 'duplicate';
}

// For the webhook after a 'duplicate': true when the booking is not settled
// yet, so Razorpay should deliver again. A row still 'paid' with no Hotelbeds
// reference is being booked or was abandoned (a later delivery takes it over
// after 90 s); a row 'failed' with nothing refunded lost its refund, so the
// owner is alerted. Booked, cancelled, or failed-and-refunded rows are settled.
export async function hotelBookingNeedsRetry(env: Record<string, any>, db: D1Like, bookingId: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT status, hb_reference, refunded, payment_id FROM hotel_bookings WHERE id = ?`)
    .bind(bookingId)
    .first<{ status: string; hb_reference: string; refunded: number; payment_id: string }>();
  if (!row) return false;
  if (row.status === 'paid' && !row.hb_reference) return true;
  if (row.status === 'failed' && !(Number(row.refunded) > 0)) {
    await alertOwner(env, bookingId, String(row.payment_id ?? ''), 'booking marked failed but no refund recorded; check the refund');
    return true;
  }
  return false;
}

// POST /api/hotels/verify
export async function handleHotelVerify(
  env: Record<string, any>,
  db: D1Like | undefined,
  raw: unknown
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!db) return { status: 503, body: { error: 'unavailable' } };
  const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const orderId = typeof body.razorpay_order_id === 'string' ? body.razorpay_order_id : '';
  const paymentId = typeof body.razorpay_payment_id === 'string' ? body.razorpay_payment_id : '';
  const signature = typeof body.razorpay_signature === 'string' ? body.razorpay_signature : '';
  if (!orderId || !paymentId || !signature) return { status: 400, body: { error: 'bad_request' } };
  if (!(await verifyRazorpaySignature(env, orderId, paymentId, signature))) return { status: 400, body: { error: 'bad_signature' } };

  // The booking id and the amount come from Razorpay's own record of the order.
  const order = await fetchRazorpayOrder(env, orderId);
  const bookingId = order.notes.kind === 'hotel' ? order.notes.hotelBookingId : '';
  if (!bookingId) return { status: 400, body: { error: 'not_hotel' } };

  const outcome = await finalizeHotelBooking(env, db, { bookingId, orderId, paymentId, amountMinor: order.amount, currency: order.currency });
  switch (outcome) {
    case 'booked':
      return { status: 200, body: { success: true, bookingId } };
    case 'unknown':
      return { status: 404, body: { error: 'not_found' } };
    case 'mismatch':
      return { status: 409, body: { error: 'payment_mismatch' } };
    case 'failed_refunded':
      return { status: 409, body: { error: 'not_booked_refunded', bookingId } };
    case 'failed_refund_error':
      return { status: 502, body: { error: 'unresolved', bookingId } };
    case 'unresolved':
      return { status: 202, body: { pending: true, bookingId } };
    case 'duplicate': {
      const now = await db.prepare(`SELECT status, refunded FROM hotel_bookings WHERE id = ?`).bind(bookingId).first<{ status: string; refunded: number }>();
      if (now?.status === 'booked') return { status: 200, body: { success: true, bookingId } };
      if (now?.status === 'paid') return { status: 202, body: { pending: true, bookingId } };
      if (now?.status === 'failed' && now.refunded > 0) return { status: 409, body: { error: 'not_booked_refunded', bookingId } };
      return { status: 409, body: { error: 'not_booked', bookingId } };
    }
  }
}
