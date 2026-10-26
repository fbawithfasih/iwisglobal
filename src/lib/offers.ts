// Offers and coupon codes (schema_offers.sql, admin /admin/offers).
//
// One discount per booking: the biggest of the Founding Guest Offer, any
// automatic offer (no code) and the coupon the customer entered. The pure
// functions here are shared by the booking widget (live estimate) and the
// server (razorpay.ts createOrder, which decides the real charge and records
// it in the trusted order notes), so the two can't drift. The DB functions
// at the bottom are server-only.
import type { D1Like } from './db';
import { forRequest } from './requestCache';
import type { Currency } from './currency';
import { CURRENCY_SYMBOLS } from './currency';
import { applyFoundingGuestDiscount, FOUNDING_GUEST_DISCOUNT_RATE } from './catalog';
import { formatTravelDate } from './format';

export interface Offer {
  id: string;
  name: string;
  code: string | null; // null = applies automatically
  kind: 'percent' | 'fixed';
  percent: number | null;
  amountInr: number | null;
  amountUsd: number | null; // null = not available for USD payments
  tourIds: string[]; // [] = every tour
  startsOn: string | null; // booking dates, YYYY-MM-DD India time, inclusive
  endsOn: string | null;
  travelFrom: string | null; // travel dates, inclusive
  travelTo: string | null;
  minTravelers: number | null;
  // A countdown offer: only for a booking made within this many minutes of the
  // visitor's first tour-page view (src/lib/offerTimer.ts). null = no countdown.
  windowMinutes: number | null;
  active: boolean;
}

export interface BookingContext {
  tourId: string;
  travelDate: string;
  travelers: number;
  currency: Currency;
  today: string; // YYYY-MM-DD, India time
  // Countdown offers: when the visitor's clock started (ms, from the signed
  // cookie) and the time now (ms). Without a start, countdown offers don't apply.
  timerStartedAt?: number | null;
  nowMs?: number;
  // Extra time the server allows past the countdown for the click on Pay to arrive.
  timerGraceMs?: number;
}

export const isCountdownOffer = (offer: Pick<Offer, 'windowMinutes'>): boolean => !!offer.windowMinutes && offer.windowMinutes > 0;

// Milliseconds left on a countdown offer (0 when over), or null when the visitor's clock hasn't started.
export function countdownLeftMs(offer: Pick<Offer, 'windowMinutes'>, startedAt: number | null | undefined, nowMs: number): number | null {
  if (!isCountdownOffer(offer) || !startedAt) return null;
  return Math.max(0, startedAt + (offer.windowMinutes ?? 0) * 60_000 - nowMs);
}

export interface Discount {
  offerId: string;
  label: string; // shown to the customer and stored on the booking
  amount: number; // major currency units
}

export const FOUNDING_GUEST_OFFER_ID = 'founding-guest';

// "12 Oct 2026" without the weekday, in the given Intl locale tag.
const shortDate = (ymd: string, tag = 'en-GB') =>
  new Date(`${ymd}T00:00:00Z`).toLocaleDateString(tag, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

// Sentence templates for everything an offer says to the customer. The
// English set is the default (the server and admin use it); pages pass the
// visitor's language from the dictionary. "{value}", "{date}" ... are filled in.
export interface OfferText {
  off: string;
  bookBy: string;
  travelRange: string;
  travelFrom: string;
  travelBy: string;
  minTravelers: string;
  inactive: string;
  wrongTour: string;
  startsOn: string;
  ended: string;
  validFrom: string;
  validUntil: string;
  minTravelersProblem: string;
  notInCurrency: string;
  // Display extras used by the tour page and booking widget (English defaults below).
  offBadge?: string;
  applied?: string;
  checkout?: string;
  founding?: string;
  dateTag?: string;
  // Countdown offers.
  bookWithin?: string;
  countdownEnded?: string;
  countdownNotStarted?: string;
  countdownBanner?: string;
  // Countdown offer on the home page and tour cards.
  cardCountdown?: string;
  heroDeal?: string;
  promoKicker?: string;
  promoBody?: string;
  promoCta?: string;
  promoNote?: string;
}
export const EN_OFFER_TEXT: OfferText = {
  off: '{value} off',
  bookBy: 'book by {date}',
  travelRange: 'travel {from}–{to}',
  travelFrom: 'travel from {date}',
  travelBy: 'travel by {date}',
  minTravelers: '{n}+ travelers',
  inactive: 'This code is no longer active.',
  wrongTour: "This code isn't valid for this tour.",
  startsOn: 'This offer starts on {date}.',
  ended: 'This offer has ended.',
  validFrom: 'Valid for travel from {date}.',
  validUntil: 'Valid for travel until {date}.',
  minTravelersProblem: 'Valid for {n} or more travelers.',
  notInCurrency: 'Not available when paying in {currency}.',
  offBadge: 'OFF',
  applied: 'Applied automatically, no code needed.',
  checkout: 'No code needed; it comes off at checkout.',
  founding: 'Founding Guest Offer ({percent}% off)',
  bookWithin: 'book within {n} minutes',
  countdownEnded: 'Your {n}-minute offer has ended.',
  countdownNotStarted: 'This offer is for bookings made within {n} minutes of opening a tour page.',
  countdownBanner: 'Book in the next {time} and get {value} off. No code needed.',
  cardCountdown: '{value} off · book within {n} min',
  heroDeal: '{value} off when you book within {n} minutes',
  promoKicker: 'Limited-time deal',
  promoBody: 'Open an eligible tour and book within {n} minutes: {value} comes off automatically at checkout. No code needed.',
  promoCta: 'See the tours',
  promoNote: 'Your {n} minutes start when you first open a tour page.',
};
const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));

function fixedAmount(offer: Offer, currency: Currency): number | null {
  return currency === 'USD' ? offer.amountUsd : offer.amountInr;
}

// "10%" / "₹1,000": the amount alone.
export function offerBadgeValue(offer: Offer, currency: Currency): string {
  if (offer.kind === 'percent') return `${offer.percent}%`;
  const amount = fixedAmount(offer, currency) ?? offer.amountInr ?? 0;
  const cur: Currency = fixedAmount(offer, currency) != null ? currency : 'INR';
  return `${CURRENCY_SYMBOLS[cur]}${amount.toLocaleString(cur === 'USD' ? 'en-US' : 'en-IN')}`;
}

// "10% off" / "₹1,000 off".
export function offerValueLabel(offer: Offer, currency: Currency, text: OfferText = EN_OFFER_TEXT): string {
  return fill(text.off, { value: offerBadgeValue(offer, currency) });
}

// The conditions a customer needs to know, e.g. "book by 5 Nov · travel
// 1 Dec–31 Jan · 4+ travelers". The admin list shows the booking window
// separately (offerBookingWindow), so it passes includeBookBy: false.
export function offerConditions(offer: Offer, { includeBookBy = true } = {}, text: OfferText = EN_OFFER_TEXT): string {
  const d = (ymd: string) => shortDate(ymd, text.dateTag);
  const parts: string[] = [];
  if (isCountdownOffer(offer)) parts.push(fill(text.bookWithin ?? EN_OFFER_TEXT.bookWithin!, { n: offer.windowMinutes! }));
  if (includeBookBy && offer.endsOn) parts.push(fill(text.bookBy, { date: d(offer.endsOn) }));
  if (offer.travelFrom && offer.travelTo) parts.push(fill(text.travelRange, { from: d(offer.travelFrom), to: d(offer.travelTo) }));
  else if (offer.travelFrom) parts.push(fill(text.travelFrom, { date: d(offer.travelFrom) }));
  else if (offer.travelTo) parts.push(fill(text.travelBy, { date: d(offer.travelTo) }));
  if (offer.minTravelers && offer.minTravelers > 1) parts.push(fill(text.minTravelers, { n: offer.minTravelers }));
  return parts.join(' · ');
}

// Admin list: "Bookable 1 Oct 2026 – 15 Dec 2026", or null with no limits.
export function offerBookingWindow(offer: Offer): string | null {
  if (offer.startsOn && offer.endsOn) return `Bookable ${shortDate(offer.startsOn)} – ${shortDate(offer.endsOn)}`;
  if (offer.startsOn) return `Bookable from ${shortDate(offer.startsOn)}`;
  if (offer.endsOn) return `Bookable until ${shortDate(offer.endsOn)}`;
  return null;
}

// Short badge for a tour card, e.g. "Diwali Offer · 10% off", from the
// first automatic offer live for the tour (offers from listLiveAutomaticOffers).
// Countdown offers are left out: only the booking widget, which knows the visitor's clock, shows them.
export function offerBadge(offers: Offer[], tourId: string, currency: Currency, text: OfferText = EN_OFFER_TEXT): string | null {
  const offer = offers.find((o) => !isCountdownOffer(o) && (o.tourIds.length === 0 || o.tourIds.includes(tourId)));
  return offer ? `${offer.name} · ${offerValueLabel(offer, currency, text)}` : null;
}

// The first live countdown offer (for this tour, when given): the home page promotes it and tour cards flag it.
// Only the booking widget knows the visitor's clock, so these say how the deal works, never how much time is left.
export function liveCountdownOffer(offers: Offer[], tourId?: string): Offer | null {
  return offers.find((o) => isCountdownOffer(o) && (!tourId || o.tourIds.length === 0 || o.tourIds.includes(tourId))) ?? null;
}

// "20% off · book within 30 min" for a tour card, or null when no countdown offer covers the tour.
export function countdownCardBadge(offers: Offer[], tourId: string, currency: Currency, text: OfferText = EN_OFFER_TEXT): string | null {
  const offer = liveCountdownOffer(offers, tourId);
  return offer ? fill(text.cardCountdown ?? EN_OFFER_TEXT.cardCountdown!, { value: offerBadgeValue(offer, currency), n: offer.windowMinutes! }) : null;
}

// Whether the offer is live for this tour on this booking date — the part
// that doesn't depend on what the customer picks at checkout.
export function offerLiveFor(offer: Offer, tourId: string, today: string): boolean {
  return (
    offer.active &&
    (offer.tourIds.length === 0 || offer.tourIds.includes(tourId)) &&
    (!offer.startsOn || today >= offer.startsOn) &&
    (!offer.endsOn || today <= offer.endsOn)
  );
}

// Why the offer can't be used for this booking, or null if it can.
export function offerProblem(offer: Offer, ctx: BookingContext, text: OfferText = EN_OFFER_TEXT): string | null {
  const d = (ymd: string) => shortDate(ymd, text.dateTag);
  if (!offer.active) return text.inactive;
  if (offer.tourIds.length > 0 && !offer.tourIds.includes(ctx.tourId)) return text.wrongTour;
  if (offer.startsOn && ctx.today < offer.startsOn) return fill(text.startsOn, { date: d(offer.startsOn) });
  if (offer.endsOn && ctx.today > offer.endsOn) return text.ended;
  if (offer.travelFrom && ctx.travelDate < offer.travelFrom) return fill(text.validFrom, { date: d(offer.travelFrom) });
  if (offer.travelTo && ctx.travelDate > offer.travelTo) return fill(text.validUntil, { date: d(offer.travelTo) });
  if (offer.minTravelers && ctx.travelers < offer.minTravelers) return fill(text.minTravelersProblem, { n: offer.minTravelers });
  if (offer.kind === 'fixed' && fixedAmount(offer, ctx.currency) == null) return fill(text.notInCurrency, { currency: ctx.currency });
  if (isCountdownOffer(offer)) {
    const n = offer.windowMinutes!;
    if (!ctx.timerStartedAt) return fill(text.countdownNotStarted ?? EN_OFFER_TEXT.countdownNotStarted!, { n });
    const endsAt = ctx.timerStartedAt + n * 60_000 + (ctx.timerGraceMs ?? 0);
    if ((ctx.nowMs ?? Date.now()) >= endsAt) return fill(text.countdownEnded ?? EN_OFFER_TEXT.countdownEnded!, { n });
  }
  return null;
}

// Whole rupees/dollars, and never below 1 unit left to pay.
export function offerDiscount(offer: Offer, total: number, currency: Currency): number {
  const raw = offer.kind === 'percent' ? Math.round((total * (offer.percent ?? 0)) / 100) : fixedAmount(offer, currency) ?? 0;
  return Math.max(0, Math.min(raw, total - 1));
}

// The single discount a booking gets: the biggest usable one, or null.
export function bestDiscount(total: number, ctx: BookingContext, offers: Offer[], foundingGuest: boolean): Discount | null {
  const candidates: Discount[] = [];
  if (foundingGuest) {
    candidates.push({
      offerId: FOUNDING_GUEST_OFFER_ID,
      label: `Founding Guest Offer (${Math.round(FOUNDING_GUEST_DISCOUNT_RATE * 100)}% off)`,
      amount: total - applyFoundingGuestDiscount(total, true),
    });
  }
  for (const offer of offers) {
    if (offerProblem(offer, ctx)) continue;
    candidates.push({ offerId: offer.id, label: `${offer.name} (${offerValueLabel(offer, ctx.currency)})`, amount: offerDiscount(offer, total, ctx.currency) });
  }
  return candidates.filter((c) => c.amount > 0).reduce<Discount | null>((best, c) => (!best || c.amount > best.amount ? c : best), null);
}

// ---- Server-only (D1) ----

export class CouponError extends Error {}

interface OfferRow {
  id: string;
  name: string;
  code: string | null;
  kind: 'percent' | 'fixed';
  percent: number | null;
  amount_inr: number | null;
  amount_usd: number | null;
  tour_ids: string;
  starts_on: string | null;
  ends_on: string | null;
  travel_from: string | null;
  travel_to: string | null;
  min_travelers: number | null;
  window_minutes?: number | null;
  active: number;
}

function toOffer(row: OfferRow): Offer {
  let tourIds: string[] = [];
  try {
    tourIds = JSON.parse(row.tour_ids) ?? [];
  } catch {}
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    kind: row.kind,
    percent: row.percent,
    amountInr: row.amount_inr,
    amountUsd: row.amount_usd,
    tourIds,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    travelFrom: row.travel_from,
    travelTo: row.travel_to,
    minTravelers: row.min_travelers,
    windowMinutes: row.window_minutes ?? null,
    active: !!row.active,
  };
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

export async function listOffers(db: D1Like): Promise<(Offer & { uses: number })[]> {
  const { results } = await db
    .prepare(
      `SELECT o.*, (SELECT COUNT(*) FROM bookings b WHERE b.offer_id = o.id) AS uses
       FROM offers o ORDER BY o.created_at DESC`
    )
    .bind()
    .all<OfferRow & { uses: number }>();
  return results.map((r) => ({ ...toOffer(r), uses: r.uses }));
}

export async function getOffer(db: D1Like, id: string): Promise<Offer | null> {
  const row = await db.prepare(`SELECT * FROM offers WHERE id = ?`).bind(id).first<OfferRow>();
  return row ? toOffer(row) : null;
}

export async function getOfferByCode(db: D1Like, code: string): Promise<Offer | null> {
  const row = await db.prepare(`SELECT * FROM offers WHERE code = ?`).bind(normalizeCode(code)).first<OfferRow>();
  return row ? toOffer(row) : null;
}

// Automatic offers live on this booking date (any tour).
export async function listLiveAutomaticOffers(db: D1Like, today: string): Promise<Offer[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM offers WHERE code IS NULL AND active = 1
         AND (starts_on IS NULL OR starts_on <= ?) AND (ends_on IS NULL OR ends_on >= ?)
       ORDER BY created_at DESC`
    )
    .bind(today, today)
    .all<OfferRow>();
  return results.map(toOffer);
}

// The same list, fetched once per page request however many tour cards ask.
export function liveAutomaticOffersForRequest(db: D1Like, request: Request, today: string): Promise<Offer[]> {
  return forRequest(request, 'liveAutomaticOffers', () => listLiveAutomaticOffers(db, today).catch(() => []));
}

// A coupon the customer typed, checked for this tour on today's date. The
// travel-date and group-size conditions are checked against the actual
// booking (offerProblem) at checkout and again when the order is created.
export async function findCoupon(db: D1Like, code: string, tourId: string, today: string): Promise<Offer> {
  const offer = code.trim() ? await getOfferByCode(db, code) : null;
  if (!offer) throw new CouponError("That code isn't valid.");
  if (!offer.active) throw new CouponError('This code is no longer active.');
  if (offer.tourIds.length > 0 && !offer.tourIds.includes(tourId)) throw new CouponError("This code isn't valid for this tour.");
  if (offer.startsOn && today < offer.startsOn) throw new CouponError(`This code starts working on ${shortDate(offer.startsOn)}.`);
  if (offer.endsOn && today > offer.endsOn) throw new CouponError('This code has expired.');
  return offer;
}

// The discount the server charges with. Throws CouponError if the entered
// code can't be used for this booking, so the customer is never charged a
// different price from the one the widget showed.
export async function resolveBookingDiscount(
  db: D1Like,
  ctx: BookingContext,
  total: number,
  foundingGuest: boolean,
  couponCode?: string
): Promise<Discount | null> {
  const offers = (await listLiveAutomaticOffers(db, ctx.today)).filter((o) => offerLiveFor(o, ctx.tourId, ctx.today));
  if (couponCode && couponCode.trim()) {
    const coupon = await findCoupon(db, couponCode, ctx.tourId, ctx.today);
    const problem = offerProblem(coupon, ctx);
    if (problem) throw new CouponError(problem);
    offers.push(coupon);
  }
  return bestDiscount(total, ctx, offers, foundingGuest);
}

export interface OfferInput {
  name: string;
  code: string | null;
  kind: 'percent' | 'fixed';
  percent: number | null;
  amountInr: number | null;
  amountUsd: number | null;
  tourIds: string[];
  startsOn: string | null;
  endsOn: string | null;
  travelFrom: string | null;
  travelTo: string | null;
  minTravelers: number | null;
  windowMinutes: number | null;
  active: boolean;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Reads and validates the admin offer form. Always returns what was typed
// (so the form can be shown again after an error), plus an error message
// when it can't be saved.
export function parseOfferForm(form: FormData): { input: OfferInput; error?: string } {
  const text = (k: string) => String(form.get(k) ?? '').trim();
  const int = (k: string) => (text(k) === '' ? null : Math.round(Number(text(k))));
  const date = (k: string) => (DATE.test(text(k)) ? text(k) : null);

  const name = text('name');
  const code = text('code') ? normalizeCode(text('code')) : null;
  const kind = text('kind') === 'fixed' ? 'fixed' : 'percent';
  const input: OfferInput = {
    name,
    code,
    kind,
    percent: kind === 'percent' ? int('percent') : null,
    amountInr: kind === 'fixed' ? int('amountInr') : null,
    amountUsd: kind === 'fixed' ? int('amountUsd') : null,
    tourIds: form.getAll('tourIds').map(String).filter(Boolean),
    startsOn: date('startsOn'),
    endsOn: date('endsOn'),
    travelFrom: date('travelFrom'),
    travelTo: date('travelTo'),
    minTravelers: int('minTravelers'),
    windowMinutes: int('windowMinutes'),
    active: form.get('active') === 'on',
  };

  if (!name) return { input, error: 'Give the offer a name customers will see, e.g. "Diwali Offer".' };
  if (code && !/^[A-Z0-9-]{3,20}$/.test(code)) return { input, error: 'Codes are 3–20 letters, numbers or dashes, e.g. DIWALI10.' };
  if (kind === 'percent' && !(input.percent && input.percent >= 1 && input.percent <= 90)) return { input, error: 'Percentage must be between 1 and 90.' };
  if (kind === 'fixed' && !(input.amountInr && input.amountInr > 0)) return { input, error: 'Enter the rupee amount off.' };
  if (kind === 'fixed' && input.amountUsd != null && input.amountUsd <= 0) return { input, error: 'The dollar amount must be more than 0, or left blank.' };
  if (input.startsOn && input.endsOn && input.endsOn < input.startsOn) return { input, error: 'The booking end date is before the start date.' };
  if (input.travelFrom && input.travelTo && input.travelTo < input.travelFrom) return { input, error: 'The travel end date is before the travel start date.' };
  if (input.minTravelers != null && input.minTravelers < 1) return { input, error: 'Minimum travelers must be at least 1, or left blank.' };
  if (input.windowMinutes != null && !(input.windowMinutes >= 5 && input.windowMinutes <= 1440)) return { input, error: 'The countdown must be 5 to 1,440 minutes, or left blank.' };
  if (input.windowMinutes != null && code) return { input, error: 'A countdown offer applies automatically, so leave the code empty.' };
  return { input };
}

function bindInput(input: OfferInput) {
  return [
    input.name,
    input.code,
    input.kind,
    input.percent,
    input.amountInr,
    input.amountUsd,
    JSON.stringify(input.tourIds),
    input.startsOn,
    input.endsOn,
    input.travelFrom,
    input.travelTo,
    input.minTravelers,
    input.windowMinutes,
    input.active ? 1 : 0,
  ];
}

async function assertCodeFree(db: D1Like, code: string | null, exceptId?: string) {
  if (!code) return;
  const other = await getOfferByCode(db, code);
  if (other && other.id !== exceptId) throw new Error(`The code ${code} is already used by "${other.name}".`);
}

export async function createOffer(db: D1Like, input: OfferInput): Promise<string> {
  await assertCodeFree(db, input.code);
  const id = `offer_${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO offers (name, code, kind, percent, amount_inr, amount_usd, tour_ids, starts_on, ends_on,
         travel_from, travel_to, min_travelers, window_minutes, active, id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(...bindInput(input), id, new Date().toISOString())
    .run();
  return id;
}

export async function updateOffer(db: D1Like, id: string, input: OfferInput): Promise<void> {
  await assertCodeFree(db, input.code, id);
  await db
    .prepare(
      `UPDATE offers SET name = ?, code = ?, kind = ?, percent = ?, amount_inr = ?, amount_usd = ?, tour_ids = ?,
         starts_on = ?, ends_on = ?, travel_from = ?, travel_to = ?, min_travelers = ?, window_minutes = ?, active = ?
       WHERE id = ?`
    )
    .bind(...bindInput(input), id)
    .run();
}

export async function deleteOffer(db: D1Like, id: string): Promise<void> {
  await db.prepare(`DELETE FROM offers WHERE id = ?`).bind(id).run();
}

// For the admin list.
export function offerStatus(offer: Offer, today: string): 'Off' | 'Scheduled' | 'Running' | 'Ended' {
  if (!offer.active) return 'Off';
  if (offer.startsOn && today < offer.startsOn) return 'Scheduled';
  if (offer.endsOn && today > offer.endsOn) return 'Ended';
  return 'Running';
}
