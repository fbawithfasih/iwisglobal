// CRM (Phase 2) queries: booking management, itinerary notes, and leads.
// Separate from db.ts, which stays focused on the payment-verified booking
// write path (src/pages/api/verify-payment.ts).

import type { D1Like } from './db';

export interface BookingRow {
  id: string;
  payment_id: string;
  order_id: string;
  tour_id: string;
  travel_date: string;
  travelers: number;
  add_on_ids: string;
  traveler_name: string;
  traveler_email: string;
  traveler_phone: string;
  amount_paid: number;
  currency: string;
  status: string;
  source: string;
  pickup_time: string;
  guide_assigned: string;
  vehicle: string;
  created_at: string;
  review_requested_at: string | null;
  total_amount: number;
  payment_type: string;
  tickets_purchased_at: string | null;
  ticket_file_key: string | null;
  ticket_emailed_at: string | null;
}

export interface BookingFilters {
  status?: string;
  tourId?: string;
}

export async function listBookings(db: D1Like, filters: BookingFilters = {}): Promise<BookingRow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.status) {
    clauses.push('status = ?');
    params.push(filters.status);
  }
  if (filters.tourId) {
    clauses.push('tour_id = ?');
    params.push(filters.tourId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { results } = await db
    .prepare(`SELECT * FROM bookings ${where} ORDER BY travel_date DESC, created_at DESC`)
    .bind(...params)
    .all<BookingRow>();
  return results;
}

export async function getBookingById(db: D1Like, id: string): Promise<BookingRow | null> {
  return db.prepare(`SELECT * FROM bookings WHERE id = ?`).bind(id).first<BookingRow>();
}

// The booking a Razorpay payment created (payment ids are unique per booking).
export async function getBookingByPaymentId(db: D1Like, paymentId: string): Promise<BookingRow | null> {
  return db.prepare(`SELECT * FROM bookings WHERE payment_id = ?`).bind(paymentId).first<BookingRow>();
}

// Entry-ticket fulfilment (see lib/entryTickets.ts). Unticking "purchased"
// clears the timestamp but keeps any uploaded e-ticket file.
export async function setTicketsPurchased(db: D1Like, id: string, purchased: boolean): Promise<void> {
  await db
    .prepare(`UPDATE bookings SET tickets_purchased_at = ? WHERE id = ?`)
    .bind(purchased ? new Date().toISOString() : null, id)
    .run();
}

// Uploading the e-ticket implies the tickets were bought.
export async function setTicketFile(db: D1Like, id: string, fileKey: string): Promise<void> {
  await db
    .prepare(`UPDATE bookings SET ticket_file_key = ?, tickets_purchased_at = COALESCE(tickets_purchased_at, ?) WHERE id = ?`)
    .bind(fileKey, new Date().toISOString(), id)
    .run();
}

export async function markTicketEmailed(db: D1Like, id: string): Promise<void> {
  await db.prepare(`UPDATE bookings SET ticket_emailed_at = ? WHERE id = ?`).bind(new Date().toISOString(), id).run();
}

const VALID_STATUSES = ['confirmed', 'completed', 'cancelled'];

export async function updateBookingStatus(db: D1Like, id: string, status: string): Promise<void> {
  if (!VALID_STATUSES.includes(status)) throw new Error('Invalid status');
  await db.prepare(`UPDATE bookings SET status = ? WHERE id = ?`).bind(status, id).run();
}

// Backlog 1.2 — bookings whose travel date has passed (drop-off already
// happened) and haven't had a review request sent yet. Cancelled bookings
// are excluded since the guest never actually traveled. Ordered oldest
// first so the ones most overdue for a request surface at the top.
export async function listReviewCandidates(db: D1Like): Promise<BookingRow[]> {
  const today = new Date().toISOString().slice(0, 10);
  const { results } = await db
    .prepare(
      `SELECT * FROM bookings
       WHERE travel_date < ? AND status != 'cancelled' AND review_requested_at IS NULL
       ORDER BY travel_date ASC`
    )
    .bind(today)
    .all<BookingRow>();
  return results;
}

export async function markReviewRequested(db: D1Like, id: string): Promise<void> {
  await db.prepare(`UPDATE bookings SET review_requested_at = ? WHERE id = ?`).bind(new Date().toISOString(), id).run();
}

export async function updateBookingItinerary(
  db: D1Like,
  id: string,
  fields: { pickupTime: string; guideAssigned: string; vehicle: string }
): Promise<void> {
  await db
    .prepare(`UPDATE bookings SET pickup_time = ?, guide_assigned = ?, vehicle = ? WHERE id = ?`)
    .bind(fields.pickupTime, fields.guideAssigned, fields.vehicle, id)
    .run();
}

export interface ManualBookingInput {
  tourId: string;
  travelDate: string;
  travelers: number;
  addOnIds: string[];
  travelerName: string;
  travelerEmail: string;
  travelerPhone: string;
  amountPaid: number; // smallest currency subunit
  currency: string;
}

// A booking taken outside the website flow (phone/WhatsApp inquiry) — no
// real Razorpay payment exists, so payment_id/order_id are synthetic but
// still satisfy the UNIQUE constraint the payment-verified path relies on.
export async function insertManualBooking(db: D1Like, input: ManualBookingInput): Promise<string> {
  const id = `bk_manual_${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO bookings
        (id, payment_id, order_id, tour_id, travel_date, travelers, add_on_ids,
         traveler_name, traveler_email, traveler_phone, amount_paid, currency,
         status, source, pickup_time, guide_assigned, vehicle, created_at,
         total_amount, payment_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', 'manual', '', '', ?, ?, ?, 'full')`
    )
    .bind(
      id,
      `manual_${id}`,
      `manual_${id}`,
      input.tourId,
      input.travelDate,
      input.travelers,
      input.addOnIds.join(','),
      input.travelerName,
      input.travelerEmail,
      input.travelerPhone,
      input.amountPaid,
      input.currency,
      new Date().toISOString(),
      new Date().toISOString(),
      // Manual bookings (phone/WhatsApp) don't offer the deposit option —
      // total always equals what was recorded as paid.
      input.amountPaid
    )
    .run();
  return id;
}

export interface BookingNoteRow {
  id: string;
  booking_id: string;
  note: string;
  created_at: string;
}

export async function listBookingNotes(db: D1Like, bookingId: string): Promise<BookingNoteRow[]> {
  const { results } = await db
    .prepare(`SELECT * FROM booking_notes WHERE booking_id = ? ORDER BY created_at DESC`)
    .bind(bookingId)
    .all<BookingNoteRow>();
  return results;
}

export async function addBookingNote(db: D1Like, bookingId: string, note: string): Promise<void> {
  await db
    .prepare(`INSERT INTO booking_notes (id, booking_id, note, created_at) VALUES (?, ?, ?, ?)`)
    .bind(`note_${crypto.randomUUID()}`, bookingId, note, new Date().toISOString())
    .run();
}

export interface LeadRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  message: string;
  tour_interest: string;
  status: string;
  created_at: string;
}

export async function listLeads(db: D1Like, status?: string): Promise<LeadRow[]> {
  const where = status ? 'WHERE status = ?' : '';
  const { results } = await db
    .prepare(`SELECT * FROM leads ${where} ORDER BY created_at DESC`)
    .bind(...(status ? [status] : []))
    .all<LeadRow>();
  return results;
}

export interface LeadInput {
  name: string;
  email: string;
  phone: string;
  message: string;
  tourInterest: string;
}

export async function insertLead(db: D1Like, input: LeadInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO leads (id, name, email, phone, message, tour_interest, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'new', ?)`
    )
    .bind(
      `lead_${crypto.randomUUID()}`,
      input.name,
      input.email,
      input.phone,
      input.message,
      input.tourInterest,
      new Date().toISOString()
    )
    .run();
}

const VALID_LEAD_STATUSES = ['new', 'contacted', 'converted', 'lost'];

export async function updateLeadStatus(db: D1Like, id: string, status: string): Promise<void> {
  if (!VALID_LEAD_STATUSES.includes(status)) throw new Error('Invalid status');
  await db.prepare(`UPDATE leads SET status = ? WHERE id = ?`).bind(status, id).run();
}
