// Paying the balance of a tour booking online, for a guest who paid a deposit
// (the tour widget takes 25% now, the rest used to be cash on pickup).
//
//   link      the admin makes a private link for a booking (/pay/<token>). The
//             amount is the booking's balance, stored on the link row.
//   order     the guest opens the link and pays. The browser sends only the
//             token; the order is opened for the STORED amount, and only while
//             the booking still owes exactly that amount.
//   finalize  after payment (the browser's verify call or Razorpay's webhook,
//             whichever is first) the payment is checked against the stored row
//             and claimed atomically. Only the claim's winner emails; a repeat is
//             a silent 'duplicate' that re-applies the (idempotent) booking
//             update, so a worker that died after the claim is completed later.
//             A payment that does not fit changes nothing and alerts the owner;
//             money is never silently refunded.
//
// Same trust model as private offers (src/lib/offerPayment.ts).

import type { D1Like } from './db';
import { getBookingById, type BookingRow } from './crm';
import { createBalanceOrder, fetchRazorpayOrder, verifyRazorpaySignature } from './payments/razorpay';
import { sendBalanceReceiptEmail, sendHotelAlertEmail } from './email';
import { formatMoneyMinor } from './format';
import { getTourById, localizeTour } from './tours';
import { emailLocale, type Locale } from './i18n';
import { getDictionary } from '../i18n/dictionaries';

export const SITE_URL = 'https://www.iwisglobal.com';
// ?lang= makes the page open in the guest's language, like the rest of the site.
export const balanceLinkUrl = (token: string, locale: Locale = 'en'): string => `${SITE_URL}/pay/${token}${locale === 'en' ? '' : `?lang=${locale}`}`;

export interface BalanceLink {
  id: string;
  booking_id: string;
  amount_minor: number;
  currency: string;
  order_id: string;
  payment_id: string;
  status: string;
}

export interface HandlerResult {
  status: number;
  body: Record<string, unknown>;
}

const changed = (res: unknown): boolean => (res as any)?.meta?.changes === 1;
const isUniqueViolation = (e: unknown): boolean => /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(e instanceof Error ? e.message : String(e));
const publicKeyOf = (env: Record<string, any>): string => env.PUBLIC_RAZORPAY_KEY_ID ?? env.RAZORPAY_KEY_ID;
const validToken = (t: unknown): t is string => typeof t === 'string' && /^[0-9a-f]{32}$/.test(t);

// What the booking still owes. Old bookings without a stored total owe nothing.
export function balanceOwed(b: Pick<BookingRow, 'total_amount' | 'amount_paid'>): number {
  return typeof b.total_amount === 'number' ? Math.max(0, b.total_amount - b.amount_paid) : 0;
}

const PAYABLE_STATUSES = new Set(['confirmed', 'completed']);

export type CreateLinkResult = { ok: true; token: string; amountMinor: number; currency: string; booking: BookingRow } | { ok: false; error: string };

// The admin's "Create balance link". Reuses the open link when the balance has
// not changed, and voids open links for a different amount.
async function createBalanceLinkUnsafe(db: D1Like, bookingId: string, now: Date): Promise<CreateLinkResult> {
  const booking = await getBookingById(db, bookingId);
  if (!booking) return { ok: false, error: 'Booking not found.' };
  if (!PAYABLE_STATUSES.has(booking.status)) return { ok: false, error: 'Only a confirmed or completed booking can take a balance payment.' };
  if (booking.currency !== 'INR' && booking.currency !== 'USD') return { ok: false, error: `Balance links are not available in ${booking.currency}.` };
  const owed = balanceOwed(booking);
  if (owed <= 0) return { ok: false, error: 'This booking has no balance due.' };

  const stamp = now.toISOString();
  await db
    .prepare(`UPDATE booking_balance_links SET status='void', updated_at=? WHERE booking_id=? AND status='created' AND (amount_minor != ? OR currency != ?)`)
    .bind(stamp, bookingId, owed, booking.currency)
    .run();
  const open = await db
    .prepare(`SELECT id FROM booking_balance_links WHERE booking_id=? AND status='created' AND amount_minor=? AND currency=? ORDER BY created_at LIMIT 1`)
    .bind(bookingId, owed, booking.currency)
    .first<{ id: string }>();
  if (open) return { ok: true, token: open.id, amountMinor: owed, currency: booking.currency, booking };

  const token = crypto.randomUUID().replace(/-/g, '');
  await db
    .prepare(`INSERT INTO booking_balance_links (id, booking_id, amount_minor, currency, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'created', ?, ?)`)
    .bind(token, bookingId, owed, booking.currency, stamp, stamp)
    .run();
  return { ok: true, token, amountMinor: owed, currency: booking.currency, booking };
}

export async function createBalanceLink(db: D1Like, bookingId: string, now: Date = new Date()): Promise<CreateLinkResult> {
  try {
    return await createBalanceLinkUnsafe(db, bookingId, now);
  } catch (e) {
    console.error('balance link: could not create', bookingId, e instanceof Error ? e.message : 'error');
    return { ok: false, error: 'Could not create the link. If this is the first use, the balance-links database table has not been added yet.' };
  }
}

export async function getBalanceLink(db: D1Like, token: string): Promise<BalanceLink | null> {
  if (!validToken(token)) return null;
  return db.prepare(`SELECT * FROM booking_balance_links WHERE id = ?`).bind(token).first<BalanceLink>();
}

// The admin booking page reads these on every view, so a missing table (the
// schema not applied yet) must show as "no link" rather than break the page.
export async function paidBalanceLinkFor(db: D1Like, bookingId: string): Promise<BalanceLink | null> {
  try {
    return await db.prepare(`SELECT * FROM booking_balance_links WHERE booking_id = ? AND status = 'paid' ORDER BY updated_at DESC LIMIT 1`).bind(bookingId).first<BalanceLink>();
  } catch {
    return null;
  }
}

export async function openBalanceLinkFor(db: D1Like, bookingId: string): Promise<BalanceLink | null> {
  try {
    return await db.prepare(`SELECT * FROM booking_balance_links WHERE booking_id = ? AND status = 'created' ORDER BY created_at DESC LIMIT 1`).bind(bookingId).first<BalanceLink>();
  } catch {
    return null;
  }
}

// Never throws, and carries ids and amounts only: an alert problem must not
// change what happens to money.
async function alertOwner(env: Record<string, any>, ref: string, lines: string[]): Promise<void> {
  try {
    console.error('balance payment needs attention', ref);
    await sendHotelAlertEmail(env, `Balance payment needs attention: ${ref}`, lines.join('\n'), 'Balance payment needs attention');
  } catch {
    // sendHotelAlertEmail never throws; belt and braces.
  }
}

// POST /api/balance/order
export async function handleBalanceOrder(env: Record<string, any>, db: D1Like | undefined, raw: unknown, now: Date = new Date()): Promise<HandlerResult> {
  if (!db) return { status: 503, body: { error: 'unavailable' } };
  const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  if (!validToken(body.token)) return { status: 400, body: { error: 'bad_request' } };

  const link = await getBalanceLink(db, body.token);
  if (!link || link.status === 'void') return { status: 404, body: { error: 'not_found' } };
  if (link.status === 'paid') return { status: 409, body: { error: 'already_paid' } };

  const booking = await getBookingById(db, link.booking_id);
  if (!booking || !PAYABLE_STATUSES.has(booking.status)) return { status: 409, body: { error: 'changed' } };
  if (balanceOwed(booking) !== link.amount_minor || booking.currency !== link.currency) return { status: 409, body: { error: 'changed' } };

  const reply = (orderId: string): HandlerResult => ({
    status: 200,
    body: { orderId, amount: link.amount_minor, currency: link.currency, publicKey: publicKeyOf(env) },
  });
  // A guest who closed the Razorpay window and pays again gets the same order.
  if (link.order_id) return reply(link.order_id);

  let order;
  try {
    order = await createBalanceOrder(env, { amountMinor: link.amount_minor, currency: link.currency as 'INR' | 'USD', linkId: link.id, receipt: `bal_${link.id.slice(0, 20)}` });
  } catch (e) {
    return { status: 502, body: { error: 'gateway', message: e instanceof Error ? e.message : 'Failed to create order' } };
  }
  if (!order.orderId || order.amount !== link.amount_minor || order.currency !== link.currency) {
    console.error('balance payment: Razorpay order does not match the request', link.id);
    return { status: 502, body: { error: 'gateway', message: 'The payment gateway returned an unexpected order.' } };
  }

  const res = await db
    .prepare(`UPDATE booking_balance_links SET order_id=?, updated_at=? WHERE id=? AND status='created' AND order_id=''`)
    .bind(order.orderId, now.toISOString(), link.id)
    .run();
  if (!changed(res)) {
    // A concurrent request stored its order first: use that one (ours stays unpaid and harmless).
    const again = await db.prepare(`SELECT order_id FROM booking_balance_links WHERE id = ? AND status = 'created'`).bind(link.id).first<{ order_id: string }>();
    if (!again?.order_id) return { status: 503, body: { error: 'unavailable' } };
    return reply(again.order_id);
  }
  return reply(order.orderId);
}

export type BalanceFinalizeOutcome = 'paid' | 'duplicate' | 'unknown' | 'mismatch' | 'stray';

// Sets the booking to fully paid. Idempotent, so it is safe to repeat.
async function markBookingPaid(db: D1Like, bookingId: string): Promise<void> {
  await db.prepare(`UPDATE bookings SET amount_paid = total_amount WHERE id = ? AND total_amount IS NOT NULL`).bind(bookingId).run();
}

export async function finalizeBalancePayment(
  env: Record<string, any>,
  db: D1Like,
  paid: { linkId: string; orderId: string; paymentId: string; amountMinor: number; currency: string }
): Promise<BalanceFinalizeOutcome> {
  const link = await db.prepare(`SELECT * FROM booking_balance_links WHERE id = ?`).bind(paid.linkId).first<BalanceLink>();
  if (!link) return 'unknown';

  const ids = [`Booking: ${link.booking_id}`, `Balance link: ${link.id.slice(0, 8)}…`, `Razorpay order: ${paid.orderId}`, `Razorpay payment: ${paid.paymentId}`];
  if (!link.order_id || link.order_id !== paid.orderId || link.currency !== paid.currency || link.amount_minor !== paid.amountMinor) {
    await alertOwner(env, link.booking_id, [
      ...ids,
      `Expected: ${link.amount_minor} ${link.currency} on order ${link.order_id || '(none)'}`,
      `Captured: ${paid.amountMinor} ${paid.currency}`,
      'Reason: the captured payment does not match this balance link; nothing changed, not refunded',
    ]);
    return 'mismatch';
  }

  const stamp = new Date().toISOString();
  let claimed = false;
  let conflict = false;
  try {
    const claim = await db
      .prepare(`UPDATE booking_balance_links SET status='paid', payment_id=?, updated_at=? WHERE id=? AND status='created'`)
      .bind(paid.paymentId, stamp, link.id)
      .run();
    claimed = changed(claim);
  } catch (e) {
    // The unique index on payment_id: this payment is already recorded on another
    // link. Anything else (D1 down) is thrown so the webhook retries.
    if (!isUniqueViolation(e)) throw e;
    conflict = true;
  }

  if (!claimed) {
    const now = await db.prepare(`SELECT status, payment_id FROM booking_balance_links WHERE id = ?`).bind(link.id).first<{ status: string; payment_id: string }>();
    if (!conflict && now?.status === 'paid' && now.payment_id === paid.paymentId) {
      await markBookingPaid(db, link.booking_id);
      return 'duplicate';
    }
    await alertOwner(env, link.booking_id, [
      ...ids,
      `Link status: ${now?.status ?? 'missing'}, holds payment ${now?.payment_id || '(none)'}`,
      `Amount: ${paid.amountMinor} ${paid.currency}`,
      conflict
        ? 'Reason: this Razorpay payment is already recorded on another balance link; nothing changed, not refunded'
        : 'Reason: a payment arrived for a balance link that is void or already settled; nothing changed, not refunded',
    ]);
    return 'stray';
  }

  // Claimed: the money was taken, so the booking is marked paid. If it no longer
  // owed exactly this amount (cash taken meanwhile, price edited), tell the owner.
  const booking = await getBookingById(db, link.booking_id);
  if (booking && balanceOwed(booking) !== paid.amountMinor) {
    await alertOwner(env, link.booking_id, [
      ...ids,
      `Balance owed now: ${balanceOwed(booking)} ${booking.currency}, paid online: ${paid.amountMinor} ${paid.currency}`,
      'Reason: the booking changed after the link was made; the booking is marked fully paid, check for an over-payment',
    ]);
  }
  await markBookingPaid(db, link.booking_id);

  // Best effort; only the claim's winner gets here, so each email goes out once.
  try {
    if (booking) {
      // The title is only for the email; a failed lookup must not stop it.
      const locale = emailLocale(booking.locale);
      const found = await getTourById(db, booking.tour_id).catch(() => null);
      const tour = found ? await localizeTour(db, found, locale).catch(() => found) : null;
      await sendBalanceReceiptEmail(env, {
        locale,
        to: booking.traveler_email,
        name: booking.traveler_name,
        tourTitle: tour?.title ?? getDictionary(locale).balance.fallbackTour,
        amountMinor: paid.amountMinor,
        currency: paid.currency,
        paymentId: paid.paymentId,
      });
      await sendHotelAlertEmail(
        env,
        `Balance paid: ${booking.traveler_name} ${formatMoneyMinor(paid.amountMinor, paid.currency)}`,
        [`Booking: ${booking.id}`, `Guest: ${booking.traveler_name}`, `Tour date: ${booking.travel_date}`, `Paid online: ${formatMoneyMinor(paid.amountMinor, paid.currency)}`, `Razorpay payment: ${paid.paymentId}`, 'The booking now shows fully paid.'].join('\n'),
        'Balance payment received'
      );
    }
  } catch (e) {
    console.error('balance payment: emails failed', link.id.slice(0, 8), e instanceof Error ? e.name : 'error');
  }
  return 'paid';
}

// POST /api/balance/verify
export async function handleBalanceVerify(env: Record<string, any>, db: D1Like | undefined, raw: unknown): Promise<HandlerResult> {
  if (!db) return { status: 503, body: { error: 'unavailable' } };
  const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const orderId = typeof body.razorpay_order_id === 'string' ? body.razorpay_order_id : '';
  const paymentId = typeof body.razorpay_payment_id === 'string' ? body.razorpay_payment_id : '';
  const signature = typeof body.razorpay_signature === 'string' ? body.razorpay_signature : '';
  if (!orderId || !paymentId || !signature) return { status: 400, body: { error: 'bad_request' } };
  if (!(await verifyRazorpaySignature(env, orderId, paymentId, signature))) return { status: 400, body: { error: 'bad_signature' } };

  // The link, the amount and the currency come from Razorpay's own record of the order.
  const order = await fetchRazorpayOrder(env, orderId);
  const linkId = order.notes.kind === 'balance' && typeof order.notes.balanceLinkId === 'string' ? order.notes.balanceLinkId : '';
  if (!linkId) return { status: 400, body: { error: 'not_balance' } };

  const outcome = await finalizeBalancePayment(env, db, { linkId, orderId, paymentId, amountMinor: order.amount, currency: order.currency });
  switch (outcome) {
    case 'paid':
    case 'duplicate':
      return { status: 200, body: { success: true } };
    case 'unknown':
      return { status: 404, body: { error: 'not_found' } };
    case 'mismatch':
    case 'stray':
      return { status: 409, body: { error: 'payment_mismatch' } };
  }
}
