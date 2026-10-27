import type { D1Like } from './db';

// Global admin search (src/pages/admin/search.astro). One query per kind of record, sent together (one round trip),
// each limited to a few rows. Matches names, emails, booking ids and phone digits, and a chat's WhatsApp name or number.

export const MIN_QUERY = 2;
export const PER_KIND = 8;

export interface BookingHit { id: string; traveler_name: string; traveler_email: string; travel_date: string; status: string; tour_id: string }
export interface LeadHit { id: string; name: string; email: string; phone: string; status: string; channel: string; created_at: string }
export interface ChatHit { id: string; profile_name: string | null; state: string; last_message_at: string }

export interface SearchResults {
  query: string;
  tooShort: boolean;
  bookings: BookingHit[];
  leads: LeadHit[];
  chats: ChatHit[];
  /** A kind has more matches than are shown. */
  more: { bookings: boolean; leads: boolean; chats: boolean };
}

/** Escapes LIKE wildcards so a person typing 50% or a_b searches for exactly that. */
export const likeTerm = (s: string): string => `%${s.replace(/[\\%_]/g, '\\$&')}%`;

// Phone numbers are stored in several shapes (+91 98765 43210, 919876543210, 098-765...); compare digits only.
const digitsOnly = (s: string): string => s.replace(/\D/g, '');
const strip = (col: string): string => `replace(replace(replace(replace(replace(${col}, ' ', ''), '-', ''), '+', ''), '(', ''), ')', '')`;

export async function searchAdmin(db: D1Like, raw: string): Promise<SearchResults> {
  const query = raw.trim().slice(0, 80);
  const empty: SearchResults = { query, tooShort: query.length < MIN_QUERY, bookings: [], leads: [], chats: [], more: { bookings: false, leads: false, chats: false } };
  if (empty.tooShort) return empty;

  const like = likeTerm(query);
  const digits = digitsOnly(query);
  // Short digit strings would match almost every phone. A long number is compared by its last 10 digits, so a number typed
  // with the country code (+91 98765 43210) still finds one stored without it (98765-43210), and the other way round.
  const phoneLike = digits.length >= 4 ? `%${digits.slice(-10)}%` : null;
  const phoneBooking = phoneLike ? ` OR ${strip('traveler_phone')} LIKE ?` : '';
  const phoneLead = phoneLike ? ` OR ${strip('phone')} LIKE ?` : '';
  const phoneChat = phoneLike ? ` OR id LIKE ?` : '';
  const limit = PER_KIND + 1; // one extra row tells us there are more

  const [bookings, leads, chats] = await Promise.all([
    db
      .prepare(
        `SELECT id, traveler_name, traveler_email, travel_date, status, tour_id FROM bookings
         WHERE traveler_name LIKE ? ESCAPE '\\' OR traveler_email LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\'${phoneBooking}
         ORDER BY created_at DESC LIMIT ?`
      )
      .bind(like, like, like, ...(phoneLike ? [phoneLike] : []), limit)
      .all<BookingHit>(),
    db
      .prepare(
        `SELECT id, name, email, phone, status, channel, created_at FROM leads
         WHERE name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\'${phoneLead}
         ORDER BY COALESCE(last_activity_at, created_at) DESC LIMIT ?`
      )
      .bind(like, like, ...(phoneLike ? [phoneLike] : []), limit)
      .all<LeadHit>(),
    db
      .prepare(
        `SELECT id, profile_name, state, last_message_at FROM wa_conversations
         WHERE profile_name LIKE ? ESCAPE '\\'${phoneChat}
         ORDER BY last_message_at DESC LIMIT ?`
      )
      .bind(like, ...(phoneLike ? [phoneLike] : []), limit)
      .all<ChatHit>(),
  ]);

  return {
    ...empty,
    bookings: bookings.results.slice(0, PER_KIND),
    leads: leads.results.slice(0, PER_KIND),
    chats: chats.results.slice(0, PER_KIND),
    more: { bookings: bookings.results.length > PER_KIND, leads: leads.results.length > PER_KIND, chats: chats.results.length > PER_KIND },
  };
}
