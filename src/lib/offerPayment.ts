// Payment of a private offer (src/lib/offerData.ts, src/lib/offerPricing.ts):
//
//   order     the guest picks how to pay (full, 40% booking amount, or the
//             balance), an option and a guide language, and gives a contact.
//             The amount comes ONLY from planPayment over the STORED offer and
//             its STORED paid payments; the browser contributes the choice and
//             the contact, nothing price-related. A Razorpay order is opened
//             for exactly that amount in the offer's currency.
//
//   finalize  after the guest pays (the browser's verify call or Razorpay's
//             webhook, whichever comes first), check the payment against the
//             saved payment row and claim it atomically. Safe to repeat and to
//             race: only the caller that wins the claim records the payment and
//             sends the emails. Anything that does not fit (wrong amount, wrong
//             currency, wrong order, a second payment) changes nothing and
//             alerts the owner; money is never silently accepted or refunded.
//
// Opening an order is safe to repeat: a guest who closes the Razorpay window
// and pays again gets the same order back when nothing about it changed.

import { trackLeadEvent } from './contacts';
import type { D1Like } from './db';
import { parseContact, validateContact } from './customTrip';
import { getOffer, listPaid, readOffer } from './offerData';
import { planPayment, type GuideLanguage, type PaidPayment, type PaymentKind } from './offerPricing';
import { createOfferOrder, fetchRazorpayOrder, verifyRazorpaySignature } from './payments/razorpay';
import { sendHotelAlertEmail, sendOfferAdminEmail, sendOfferReceiptEmail } from './email';

export interface HandlerResult {
  status: number;
  body: Record<string, unknown>;
}

interface PaymentRow {
  id: string;
  offer_id: string;
  option_id: string;
  guide_language: string;
  kind: string;
  amount_minor: number;
  total_minor: number;
  currency: string;
  order_id: string;
  payment_id: string;
  status: string;
  payer_name: string;
  payer_email: string;
  payer_phone: string;
}

const changed = (res: unknown): boolean => (res as any)?.meta?.changes === 1;
const publicKeyOf = (env: Record<string, any>): string => env.PUBLIC_RAZORPAY_KEY_ID ?? env.RAZORPAY_KEY_ID;
const isUniqueViolation = (e: unknown): boolean => /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(e instanceof Error ? e.message : String(e));

// Never throws, and never carries guest details: ids, kind, amount, currency
// and a reason only. An alert problem must not change what happens to money.
async function alertOwner(env: Record<string, any>, ref: string, lines: string[]): Promise<void> {
  try {
    console.error('private offer payment needs attention', ref);
    await sendHotelAlertEmail(env, `Private offer payment needs attention: ${ref}`, lines.join('\n'), 'Private offer payment needs attention');
  } catch {
    // sendHotelAlertEmail never throws; belt and braces.
  }
}

// POST /api/offer/order
export async function handleOfferOrder(env: Record<string, any>, db: D1Like | undefined, raw: unknown, now: Date = new Date()): Promise<HandlerResult> {
  if (!db) return { status: 503, body: { error: 'unavailable' } };
  const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  if (typeof body.offerId !== 'string' || body.offerId.length > 100) return { status: 400, body: { error: 'bad_request' } };

  const offer = await getOffer(db, body.offerId);
  if (!offer) return { status: 404, body: { error: 'not_found' } };

  const contact = parseContact(body.contact);
  if (!contact) return { status: 400, body: { error: 'bad_request' } };
  const contactErrors = validateContact(contact);
  if (Object.keys(contactErrors).length > 0) return { status: 400, body: { error: 'bad_contact', fields: Object.keys(contactErrors) } };
  const payerPhone = contact.phone.replace(/[\s().-]/g, '');

  let paid: PaidPayment[];
  try {
    paid = await listPaid(db, offer.id);
  } catch {
    // A paid payment we cannot read: never guess what is still due.
    await alertOwner(env, offer.id, [`Offer: ${offer.id}`, 'Reason: a paid payment row of this offer is unreadable; no new order opened']);
    return { status: 503, body: { error: 'unavailable' } };
  }

  // Only the choice goes in; the amount, kind, option and language come out of
  // the stored offer and stored payments.
  const plan = planPayment(offer.terms, paid, { mode: body.mode, optionId: body.optionId, guideLanguage: body.guideLanguage });
  if (!plan.ok) return { status: 409, body: { error: plan.error } };

  const currency = offer.currency;
  const stamp = now.toISOString();
  const reply = (id: string, orderId: string): HandlerResult => ({
    status: 200,
    body: { offerPaymentId: id, orderId, amount: plan.amountMinor, currency, publicKey: publicKeyOf(env) },
  });

  // Reuse an open payment row for exactly this payment (same kind, option,
  // language, amount and currency), refreshing the payer's details.
  const existing = await db
    .prepare(
      `SELECT id, order_id FROM offer_payments WHERE offer_id = ? AND status = 'created' AND kind = ? AND option_id = ? AND guide_language = ? AND amount_minor = ? AND currency = ? ORDER BY created_at, id LIMIT 1`
    )
    .bind(offer.id, plan.kind, plan.optionId, plan.guideLanguage, plan.amountMinor, currency)
    .first<{ id: string; order_id: string }>();

  let rowId: string;
  if (existing) {
    rowId = existing.id;
    await db
      .prepare(`UPDATE offer_payments SET payer_name=?, payer_email=?, payer_phone=?, updated_at=? WHERE id=? AND status='created'`)
      .bind(contact.name, contact.email, payerPhone, stamp, rowId)
      .run();
    if (existing.order_id) return reply(rowId, existing.order_id);
  } else {
    rowId = `op_${crypto.randomUUID()}`;
    await db
      .prepare(
        `INSERT INTO offer_payments (id, offer_id, option_id, guide_language, kind, amount_minor, total_minor, currency, order_id, payment_id, status, payer_name, payer_email, payer_phone, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', '', 'created', ?, ?, ?, ?, ?)`
      )
      .bind(rowId, offer.id, plan.optionId, plan.guideLanguage, plan.kind, plan.amountMinor, plan.totalMinor, currency, contact.name, contact.email, payerPhone, stamp, stamp)
      .run();
  }

  await trackLeadEvent(db, {
    channel: 'offer',
    identifiers: [{ type: 'email', value: contact.email }, { type: 'phone', value: payerPhone }],
    name: contact.name,
    externalRef: `offer:${offer.id}:${contact.email.trim().toLowerCase()}`,
    stage: 'quote_sent',
    message: 'Opened a private offer payment',
  });

  let order;
  try {
    order = await createOfferOrder(env, { amountMinor: plan.amountMinor, currency, offerPaymentId: rowId, receipt: rowId });
  } catch (e) {
    // The row stays 'created' with no order id; the next attempt completes it.
    return { status: 502, body: { error: 'gateway', message: e instanceof Error ? e.message : 'Failed to create order' } };
  }
  if (!order.orderId || order.amount !== plan.amountMinor || order.currency !== currency) {
    console.error('private offer: Razorpay order does not match the request', rowId);
    return { status: 502, body: { error: 'gateway', message: 'The payment gateway returned an unexpected order.' } };
  }

  const res = await db
    .prepare(`UPDATE offer_payments SET order_id=?, updated_at=? WHERE id=? AND status='created' AND order_id=''`)
    .bind(order.orderId, stamp, rowId)
    .run();
  if (!changed(res)) {
    // A concurrent request stored its order first: hand back that one (ours
    // is left unpaid and harmless).
    const again = await db.prepare(`SELECT order_id FROM offer_payments WHERE id = ? AND status = 'created'`).bind(rowId).first<{ order_id: string }>();
    if (!again?.order_id) return { status: 503, body: { error: 'unavailable' } };
    return reply(rowId, again.order_id);
  }
  return reply(rowId, order.orderId);
}

export type OfferFinalizeOutcome = 'paid' | 'duplicate' | 'unknown' | 'mismatch' | 'stray';

// Records a captured payment against its offer payment row. Exactly one caller
// gets 'paid' per row; the same payment again is a silent 'duplicate'; any
// payment that does not fit changes nothing and alerts the owner.
export async function finalizeOfferPayment(
  env: Record<string, any>,
  db: D1Like,
  paid: { offerPaymentId: string; orderId: string; paymentId: string; amountMinor: number; currency: string }
): Promise<OfferFinalizeOutcome> {
  const row = await db.prepare(`SELECT * FROM offer_payments WHERE id = ?`).bind(paid.offerPaymentId).first<PaymentRow>();
  if (!row) return 'unknown';

  const ids = [`Offer: ${row.offer_id}`, `Offer payment: ${row.id}`, `Razorpay order: ${paid.orderId}`, `Razorpay payment: ${paid.paymentId}`];
  if (!row.order_id || row.order_id !== paid.orderId || row.currency !== paid.currency || row.amount_minor !== paid.amountMinor) {
    await alertOwner(env, row.id, [
      ...ids,
      `Expected: ${row.amount_minor} ${row.currency} on order ${row.order_id || '(none)'}`,
      `Captured: ${paid.amountMinor} ${paid.currency}`,
      'Reason: the captured payment does not match this offer payment; nothing changed, not refunded',
    ]);
    return 'mismatch';
  }

  const stamp = new Date().toISOString();
  let claimed = false;
  let conflict = false;
  try {
    const claim = await db
      .prepare(`UPDATE offer_payments SET status='paid', payment_id=?, updated_at=? WHERE id=? AND status='created'`)
      .bind(paid.paymentId, stamp, row.id)
      .run();
    claimed = changed(claim);
  } catch (e) {
    // The unique index on payment_id: this payment is already recorded on
    // another row. Anything else (D1 down) is thrown so the webhook retries.
    if (!isUniqueViolation(e)) throw e;
    conflict = true;
  }

  if (!claimed) {
    const now = await db.prepare(`SELECT status, payment_id FROM offer_payments WHERE id = ?`).bind(row.id).first<{ status: string; payment_id: string }>();
    if (!conflict && now?.status === 'paid' && now.payment_id === paid.paymentId) return 'duplicate';
    await alertOwner(env, row.id, [
      ...ids,
      `Row status: ${now?.status ?? 'missing'}, holds payment ${now?.payment_id || '(none)'}`,
      `Amount: ${paid.amountMinor} ${paid.currency}`,
      conflict
        ? 'Reason: this Razorpay payment is already recorded on another offer payment; nothing changed, not refunded'
        : 'Reason: a second payment arrived for an offer payment that is already settled; nothing changed, not refunded',
    ]);
    return 'stray';
  }

  // Claimed. A race (two orders paid at once) can leave more paid payments
  // than the offer allows: keep this one paid (the money was taken) and tell
  // the owner. The only allowed pair is one deposit followed by one balance.
  try {
    const { results } = await db
      .prepare(`SELECT id, kind, payment_id FROM offer_payments WHERE offer_id = ? AND status = 'paid' AND id != ?`)
      .bind(row.offer_id, row.id)
      .all<{ id: string; kind: string; payment_id: string }>();
    const others = results ?? [];
    const allowed = row.kind === 'balance' ? others.length === 1 && others[0].kind === 'deposit' : others.length === 0;
    if (!allowed) {
      await alertOwner(env, row.id, [
        ...ids,
        `Kind: ${row.kind}, amount: ${row.amount_minor} ${row.currency}`,
        `Other paid payments of this offer: ${others.map((o) => `${o.id} (${o.kind}, ${o.payment_id})`).join(', ') || '(none)'}`,
        'Reason: more payments recorded than the offer allows (paid twice?); all kept as paid, not refunded',
      ]);
    }
  } catch (e) {
    console.error('private offer: could not check for a double payment', row.id, e instanceof Error ? e.message : 'error');
  }

  await trackLeadEvent(db, {
    channel: 'offer',
    identifiers: [{ type: 'email', value: row.payer_email }, { type: 'phone', value: row.payer_phone }],
    name: row.payer_name,
    externalRef: `offerpaid:${row.id}`,
    stage: row.kind === 'balance' ? 'booked' : 'deposit_paid',
    note: `Private offer ${row.kind} paid`,
  });

  await ensureOfferEmails(env, db, row.id);
  return 'paid';
}

// A sender holding the email claim longer than this is taken to have died.
export const OFFER_EMAIL_CLAIM_MS = 5 * 60 * 1000;

// Sends the owner's "payment received" and the guest's receipt for a PAID
// payment row, exactly once, and completes a send that was lost (a worker
// stopped after the claim, or the owner email failed). Called after the claim
// and again on every 'duplicate' of a paid row (the browser's verify or a
// webhook redelivery). receipt_sent_at: '' = not sent, 'pending:<iso>' = a
// sender holds it (taken over after 5 minutes), <iso> = owner email sent.
// Never throws; logs ids and error names only.
export async function ensureOfferEmails(env: Record<string, any>, db: D1Like, paymentRowOrId: string | { id: string }): Promise<void> {
  const id = typeof paymentRowOrId === 'string' ? paymentRowOrId : paymentRowOrId?.id;
  let held = false;
  try {
    if (typeof id !== 'string' || !id) return;
    const now = new Date();
    const claim = await db
      .prepare(
        `UPDATE offer_payments SET receipt_sent_at = ? WHERE id = ? AND status = 'paid' AND (receipt_sent_at = '' OR (receipt_sent_at LIKE 'pending:%' AND receipt_sent_at < ?))`
      )
      .bind(`pending:${now.toISOString()}`, id, `pending:${new Date(now.getTime() - OFFER_EMAIL_CLAIM_MS).toISOString()}`)
      .run();
    if (!changed(claim)) return;
    held = true;
    const row = await db.prepare(`SELECT * FROM offer_payments WHERE id = ?`).bind(id).first<PaymentRow>();
    const ownerSent = row ? await sendOfferEmails(env, db, row) : false;
    await db
      .prepare(`UPDATE offer_payments SET receipt_sent_at = ? WHERE id = ?`)
      .bind(ownerSent ? new Date().toISOString() : '', id)
      .run();
    held = false;
  } catch (e) {
    console.error('private offer: payment emails failed', String(id), e instanceof Error ? e.name : 'error');
    if (held) {
      // Let a later delivery try again rather than leave the claim to expire.
      try {
        await db.prepare(`UPDATE offer_payments SET receipt_sent_at = '' WHERE id = ? AND receipt_sent_at LIKE 'pending:%'`).bind(id).run();
      } catch {
        // The 5-minute takeover covers this.
      }
    }
  }
}

// The owner's "payment received" and the guest's receipt (only when there is
// a payer email). True when the owner email was accepted.
async function sendOfferEmails(env: Record<string, any>, db: D1Like, row: PaymentRow): Promise<boolean> {
  const paymentId = row.payment_id;
  const offer = await readOffer(db, row.offer_id);
  const option = offer?.terms.options.find((o) => o.id === row.option_id);
  if (!offer || !option) {
    await alertOwner(env, row.id, [`Offer: ${row.offer_id}`, `Offer payment: ${row.id}`, `Razorpay payment: ${paymentId}`, 'Reason: payment recorded, but the offer is unreadable; no receipt sent']);
    return false;
  }
  const kind = row.kind as PaymentKind;
  const details = {
    offerId: offer.id,
    offerPaymentId: row.id,
    title: offer.content.title,
    dateLabel: offer.content.dateLabel,
    pickup: offer.content.pickup,
    kind,
    depositPercent: offer.terms.depositPercent,
    amountMinor: row.amount_minor,
    currency: row.currency,
    totalMinor: row.total_minor,
    balanceMinor: kind === 'deposit' ? Math.max(0, row.total_minor - row.amount_minor) : 0,
    optionLabel: option.label,
    vehicle: option.vehicle,
    guideLanguage: row.guide_language as GuideLanguage,
    payerName: row.payer_name,
    payerEmail: row.payer_email,
    payerPhone: row.payer_phone,
    paymentId,
  };
  const ownerSent = await sendOfferAdminEmail(env, { ...details, customerName: offer.customerName });
  if (row.payer_email) await sendOfferReceiptEmail(env, details);
  return ownerSent;
}

// POST /api/offer/verify
export async function handleOfferVerify(env: Record<string, any>, db: D1Like | undefined, raw: unknown): Promise<HandlerResult> {
  if (!db) return { status: 503, body: { error: 'unavailable' } };
  const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const orderId = typeof body.razorpay_order_id === 'string' ? body.razorpay_order_id : '';
  const paymentId = typeof body.razorpay_payment_id === 'string' ? body.razorpay_payment_id : '';
  const signature = typeof body.razorpay_signature === 'string' ? body.razorpay_signature : '';
  if (!orderId || !paymentId || !signature) return { status: 400, body: { error: 'bad_request' } };
  if (!(await verifyRazorpaySignature(env, orderId, paymentId, signature))) return { status: 400, body: { error: 'bad_signature' } };

  // The payment row id, the amount and the currency come from Razorpay's own
  // record of the order, never from the request.
  const order = await fetchRazorpayOrder(env, orderId);
  const offerPaymentId = order.notes.kind === 'offer' && typeof order.notes.offerPaymentId === 'string' ? order.notes.offerPaymentId : '';
  if (!offerPaymentId) return { status: 400, body: { error: 'not_offer' } };

  const outcome = await finalizeOfferPayment(env, db, { offerPaymentId, orderId, paymentId, amountMinor: order.amount, currency: order.currency });
  switch (outcome) {
    case 'paid':
      return { status: 200, body: { success: true, offerPaymentId } };
    case 'duplicate':
      // Completes the emails if the request that recorded the payment stopped
      // before sending them. Never throws.
      await ensureOfferEmails(env, db, offerPaymentId);
      return { status: 200, body: { success: true, offerPaymentId } };
    case 'unknown':
      return { status: 404, body: { error: 'not_found' } };
    case 'mismatch':
    case 'stray':
      return { status: 409, body: { error: 'payment_mismatch' } };
  }
}
