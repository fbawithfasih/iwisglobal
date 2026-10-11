// Guest ratings for tours (schema_tour_reviews.sql). A guest can only write
// a review through the private link in the "How was your tour?" email
// (bookings.review_token), so every review comes from a real, completed
// booking. Reviews wait for admin approval before they show on the site;
// the admin publishes every genuine review, good or bad.

import type { D1Like } from './db';
import { forRequest } from './requestCache';
import { markReviewRequested, type BookingRow } from './crm';
import { sendReviewRequestEmail } from './email';
import { getTourById, localizeTour } from './tours';
import { emailLocale } from './i18n';
import { todayIst } from './availability';

export type ReviewStatus = 'pending' | 'approved' | 'hidden';

export interface Review {
  id: string;
  bookingId: string;
  tourId: string;
  rating: number;
  comment: string;
  displayName: string;
  travelDate: string;
  status: ReviewStatus;
  createdAt: string;
  updatedAt: string;
}

interface ReviewRow {
  id: string;
  booking_id: string;
  tour_id: string;
  rating: number;
  comment: string;
  display_name: string;
  travel_date: string;
  status: ReviewStatus;
  created_at: string;
  updated_at: string;
}

// Google Business Profile's "write a review" link (from GBP's "Get more
// reviews"): opens the review box directly.
export const GOOGLE_REVIEW_URL = 'https://g.page/r/CWpAZOfs5QvgEBM/review';

export const MAX_COMMENT_LENGTH = 2000;
export const REVIEW_STATUSES: ReviewStatus[] = ['pending', 'approved', 'hidden'];

function toReview(r: ReviewRow): Review {
  return {
    id: r.id,
    bookingId: r.booking_id,
    tourId: r.tour_id,
    rating: r.rating,
    comment: r.comment,
    displayName: r.display_name,
    travelDate: r.travel_date,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// "aliza khan" -> "Aliza", for greetings.
export function firstNameOf(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0];
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : 'there';
}

// "Aliza Khan" -> "Aliza K." (first name and last initial only).
// A review's text as shown on the site: star emoji a guest typed at the very
// start ("⭐⭐⭐⭐⭐ Great tour") repeat the rating stars already shown, so
// they're dropped for display. The stored text is never changed.
export function displayComment(comment: string): string {
  return comment.replace(/^[\s⭐🌟★☆\uFE0F]+/u, '');
}

export function reviewDisplayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Guest';
  const first = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  return parts.length > 1 ? `${first} ${parts[parts.length - 1].charAt(0).toUpperCase()}.` : first;
}

// A tour can be rated once its date has passed, unless it was cancelled.
export function canBeReviewed(booking: Pick<BookingRow, 'travel_date' | 'status'>, today: string): boolean {
  return booking.status !== 'cancelled' && booking.travel_date < today;
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// The booking's private review link token, created on first use.
export async function ensureReviewToken(db: D1Like, booking: Pick<BookingRow, 'id' | 'review_token'>): Promise<string> {
  if (booking.review_token) return booking.review_token;
  const token = newToken();
  await db.prepare(`UPDATE bookings SET review_token = COALESCE(review_token, ?) WHERE id = ?`).bind(token, booking.id).run();
  const row = await db.prepare(`SELECT review_token FROM bookings WHERE id = ?`).bind(booking.id).first<{ review_token: string }>();
  return row?.review_token ?? token;
}

export const reviewUrl = (site: string, token: string, rating?: number) =>
  `${site}/review?t=${encodeURIComponent(token)}${rating ? `&rating=${rating}` : ''}`;

export async function getBookingByReviewToken(db: D1Like, token: string): Promise<BookingRow | null> {
  if (!token || token.length > 64) return null;
  return db.prepare(`SELECT * FROM bookings WHERE review_token = ?`).bind(token).first<BookingRow>();
}

// Which of these bookings already have a review (any status).
export async function reviewedBookingIds(db: D1Like, bookingIds: string[]): Promise<Set<string>> {
  if (bookingIds.length === 0) return new Set();
  const { results } = await db
    .prepare(`SELECT booking_id FROM tour_reviews WHERE booking_id IN (${bookingIds.map(() => '?').join(', ')})`)
    .bind(...bookingIds)
    .all<{ booking_id: string }>();
  return new Set(results.map((r) => r.booking_id));
}

export async function getReviewForBooking(db: D1Like, bookingId: string): Promise<Review | null> {
  const row = await db.prepare(`SELECT * FROM tour_reviews WHERE booking_id = ?`).bind(bookingId).first<ReviewRow>();
  return row ? toReview(row) : null;
}

// Create or update the booking's review. An edited review goes back to
// pending so the admin sees the new wording before it's shown.
export async function saveReview(
  db: D1Like,
  booking: BookingRow,
  input: { rating: number; comment: string }
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO tour_reviews (id, booking_id, tour_id, rating, comment, display_name, travel_date, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
       ON CONFLICT(booking_id) DO UPDATE SET rating = excluded.rating, comment = excluded.comment,
         status = 'pending', updated_at = excluded.updated_at`
    )
    .bind(
      `rev_${crypto.randomUUID()}`,
      booking.id,
      booking.tour_id,
      input.rating,
      input.comment,
      reviewDisplayName(booking.traveler_name),
      booking.travel_date,
      now,
      now
    )
    .run();
}

// Validates the guest's form. Returns the clean input or an error message.
export function parseReviewForm(form: FormData): { rating: number; comment: string } | { error: string } {
  const rating = Number(form.get('rating'));
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { error: 'Please choose a star rating.' };
  const comment = String(form.get('comment') ?? '').trim().replace(/\r\n/g, '\n');
  if (comment.length > MAX_COMMENT_LENGTH) return { error: `Please keep your review under ${MAX_COMMENT_LENGTH} characters.` };
  return { rating, comment };
}

export async function listReviews(db: D1Like): Promise<Review[]> {
  const { results } = await db
    .prepare(`SELECT * FROM tour_reviews ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, updated_at DESC`)
    .bind()
    .all<ReviewRow>();
  return results.map(toReview);
}

// Published reviews, newest trip first; all tours when tourId is omitted.
export async function listApprovedReviews(db: D1Like, tourId?: string): Promise<Review[]> {
  const stmt = tourId
    ? db.prepare(`SELECT * FROM tour_reviews WHERE status = 'approved' AND tour_id = ? ORDER BY travel_date DESC, created_at DESC`).bind(tourId)
    : db.prepare(`SELECT * FROM tour_reviews WHERE status = 'approved' ORDER BY travel_date DESC, created_at DESC`).bind();
  const { results } = await stmt.all<ReviewRow>();
  return results.map(toReview);
}

// Whether /reviews has anything to show; the footer links to it only then.
export async function hasApprovedReviews(db: D1Like): Promise<boolean> {
  const row = await db.prepare(`SELECT 1 AS found FROM tour_reviews WHERE status = 'approved' LIMIT 1`).bind().first<{ found: number }>();
  return !!row;
}

// Once per page request (the layout asks on every page; pages can start it early).
export function hasApprovedReviewsForRequest(db: D1Like, request: Request): Promise<boolean> {
  return forRequest(request, 'hasApprovedReviews', () => hasApprovedReviews(db).catch(() => false));
}

export async function setReviewStatus(db: D1Like, id: string, status: string): Promise<void> {
  if (!REVIEW_STATUSES.includes(status as ReviewStatus)) throw new Error('Invalid status');
  await db.prepare(`UPDATE tour_reviews SET status = ? WHERE id = ?`).bind(status, id).run();
}

export function averageRating(reviews: Review[]): number | null {
  if (reviews.length === 0) return null;
  return Math.round((reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length) * 10) / 10;
}

export const SITE_URL = 'https://www.iwisglobal.com';

export type ReviewRequestResult = 'sent' | 'no_email' | 'email_failed' | 'too_early';

// The admin "Request a review" button: emails the guest their private
// review link and records when it was sent.
export async function requestReview(env: Record<string, any>, db: D1Like, booking: BookingRow): Promise<ReviewRequestResult> {
  if (!canBeReviewed(booking, todayIst())) return 'too_early';
  if (!booking.traveler_email) return 'no_email';
  const token = await ensureReviewToken(db, booking);
  const locale = emailLocale(booking.locale);
  const found = await getTourById(db, booking.tour_id);
  const tour = found ? await localizeTour(db, found, locale) : null;
  const sent = await sendReviewRequestEmail(env, {
    to: booking.traveler_email,
    travelerName: booking.traveler_name,
    tourTitle: tour?.title ?? booking.tour_id,
    travelDate: booking.travel_date,
    reviewUrl: reviewUrl(SITE_URL, token),
    googleReviewUrl: GOOGLE_REVIEW_URL,
    locale,
  });
  if (!sent) return 'email_failed';
  await markReviewRequested(db, booking.id);
  return 'sent';
}

export const REVIEW_REQUEST_MESSAGES: Record<string, { text: string; ok: boolean }> = {
  sent: { text: 'Review request emailed to the customer.', ok: true },
  no_email: { text: 'This booking has no email address. Send the review link on WhatsApp instead.', ok: false },
  email_failed: { text: 'The email did not send (check RESEND_API_KEY). Try again, or send the link on WhatsApp.', ok: false },
  too_early: { text: 'A review can be requested once the tour date has passed (and not for cancelled bookings).', ok: false },
};

// WhatsApp message with the guest's private review link.
export function reviewWhatsappMessage(travelerName: string, link: string): string {
  return `Hi ${firstNameOf(travelerName)}! This is IWIS Global. Thank you again for touring with us. How was your tour? You can rate it here, it takes a minute: ${link}`;
}
