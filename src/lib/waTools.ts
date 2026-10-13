// Read-only lookups the WhatsApp reply agent uses when drafting (milestone 3):
// is a date bookable, what would a group pay, a booking link with the date
// filled in, and the sender's own bookings. Code runs these, never the model:
// the classifier only supplies a tour, a date and a group size, and each one is
// validated here before any query. Results go into the draft prompt as facts
// and are logged on the draft so staff can see what it relied on.
import type { D1Like } from './db';
import { MAX_TRAVELERS_PER_DATE, travelersBookedOn } from './db';
import { getCatalogItem, type ParsedTour } from './tours';
import { computeTotal, computeDepositAmount } from './catalog';
import { getAvailability, isValidDateString, isTajClosedStart, firstOpenStart, tajDayOffset, todayIst } from './availability';
import { isNightViewingTour, isNightViewingDate, nightViewingDatesFrom } from './nightViewing';
import { formatMoneyMinor } from './format';
import { SITE_URL } from './waKnowledge';

export interface ToolRequest {
  tourSlug?: string;
  date?: string;
  travelers?: number;
}

export interface ToolLog {
  name: string;
  args: Record<string, unknown>;
  result: string;
}

export interface ToolOutcome {
  log: ToolLog[];
  // Facts for the draft prompt; empty when no tool applies to the intent.
  text: string;
  // booking_status asked and the sender has no booking under this number.
  noBooking: boolean;
}

const money = (amount: number, currency: string) => (currency === 'USD' ? `$${amount.toLocaleString('en-US')}` : `₹${amount.toLocaleString('en-IN')}`);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// A group size the site would accept, else undefined.
export function validTravelers(n: unknown): number | undefined {
  const v = Number(n);
  return Number.isInteger(v) && v >= 1 && v <= MAX_TRAVELERS_PER_DATE ? v : undefined;
}

// ------------------------------------------------------------------ availability

export async function checkAvailability(
  db: D1Like,
  tour: ParsedTour,
  date: string,
  travelers: number | undefined,
  now: Date
): Promise<string> {
  const min = getAvailability(now).minBookableDate;
  const offset = tajDayOffset(tour.itinerary);
  const who = travelers ? ` for ${plural(travelers, 'traveller')}` : '';

  if (date <= todayIst(now)) return `NOT AVAILABLE: ${date} is today or in the past.`;
  if (date < min) return `NOT AVAILABLE: ${date} can no longer be booked online (bookings close at 9 PM India time the night before). The earliest date that can be booked is ${min}.`;
  if (isNightViewingTour(tour.id) && !isNightViewingDate(date)) {
    const next = nightViewingDatesFrom(min)[0];
    return `NOT AVAILABLE: the ${tour.title} runs only on the full-moon night and the two nights either side.${next ? ` The next bookable night is ${next}.` : ' No night is open for booking right now.'}`;
  }
  if (isTajClosedStart(date, offset)) {
    const why = offset === 0 ? 'the Taj Mahal is closed on Fridays' : `this tour visits the Taj Mahal on day ${offset + 1}, which would be a Friday, and the Taj Mahal is closed on Fridays`;
    return `NOT AVAILABLE on ${date}: ${why}. The next date this tour can start is ${firstOpenStart(date, offset)}.`;
  }
  const left = MAX_TRAVELERS_PER_DATE - (await travelersBookedOn(db, tour.id, date));
  if (left <= 0) return `NOT AVAILABLE on ${date}: that day is fully booked.`;
  if (travelers && travelers > left) return `NOT AVAILABLE on ${date}${who}: only ${plural(left, 'place')} left that day.`;
  return `AVAILABLE on ${date}${who}. (Checked just now; the place is only held once booked and paid.)`;
}

// ------------------------------------------------------------------------ quote

// What checkout would charge for this group with the add-ons ticked by default,
// before any offer or code. Same functions as checkout.
export async function quotePrice(db: D1Like, tour: ParsedTour, travelers: number): Promise<string> {
  const lines: string[] = [];
  for (const currency of ['INR', 'USD'] as const) {
    const item = await getCatalogItem(db, tour.id, { currency });
    if (!item || item.currency !== currency) continue;
    const defaults = (item.addOns ?? []).filter((a) => a.includedByDefault);
    const total = computeTotal(item, travelers, defaults.map((a) => a.id));
    const deposit = computeDepositAmount(total);
    const included = defaults.length ? ` (includes ${defaults.map((a) => a.name).join(', ')})` : '';
    lines.push(
      `${currency} total for ${plural(travelers, 'traveller')}: ${money(total, currency)}${included}, before any offer or code. ` +
        `Deposit option (mention only if the guest asks about a deposit): ${money(deposit, currency)} now and the rest at pickup.`
    );
  }
  return lines.length ? lines.join('\n') : 'No price could be worked out for this tour.';
}

// ------------------------------------------------------------------------- link

export function bookingLink(tour: ParsedTour, date?: string, travelers?: number): string {
  const params = new URLSearchParams();
  if (date) params.set('date', date);
  if (travelers) params.set('travelers', String(travelers));
  const query = params.toString();
  return `${SITE_URL}/tours/${tour.slug}${query ? `?${query}` : ''}`;
}

// ------------------------------------------------------------ the sender's bookings

interface OwnBookingRow {
  tour_id: string;
  travel_date: string;
  travelers: number;
  status: string;
  pickup_time: string;
  total_amount: number;
  amount_paid: number;
  currency: string;
}

// Bookings made with the phone number the guest is messaging from: an exact
// match on the digits, country code included. The chat text never selects a
// booking, so another guest's booking cannot be asked for. A booking stored
// without a country code is not matched; the guest is asked for their email.
export async function ownBookings(db: D1Like, senderPhone: string, tours: ParsedTour[]): Promise<{ text: string; found: boolean }> {
  const digits = senderPhone.replace(/\D/g, '');
  if (digits.length < 8) return { text: 'No booking found for this WhatsApp number.', found: false };
  const { results } = await db
    .prepare(
      `SELECT tour_id, travel_date, travelers, status, pickup_time, total_amount, amount_paid, currency
       FROM bookings
       WHERE replace(replace(replace(replace(replace(replace(traveler_phone, ' ', ''), '-', ''), '+', ''), '(', ''), ')', ''), '.', '') = ?
       ORDER BY travel_date DESC LIMIT 3`
    )
    .bind(digits)
    .all<OwnBookingRow>();
  if (!results.length) return { text: 'No booking found for this WhatsApp number.', found: false };

  const title = new Map(tours.map((t) => [t.id, t.title]));
  const lines = results.map((b, i) => {
    const balance = b.total_amount - b.amount_paid;
    return (
      `Booking ${i + 1}: ${title.get(b.tour_id) ?? 'tour'}, ${b.travel_date}, ${plural(b.travelers, 'traveller')}, status ${b.status}, ` +
      `pickup time ${b.pickup_time || 'not set yet'}, ${balance > 0 ? `balance due at pickup ${formatMoneyMinor(balance, b.currency)}` : 'paid in full'}.`
    );
  });
  return { text: lines.join('\n'), found: true };
}

// ----------------------------------------------------------------------- driver

const QUOTE_INTENTS = new Set(['price', 'policy', 'how_to_book', 'tour_info']);

// Runs the lookups an intent calls for. Missing details are reported as such,
// so the draft asks the guest instead of guessing.
export async function runTools(
  db: D1Like,
  intent: string,
  req: ToolRequest,
  senderPhone: string,
  tours: ParsedTour[],
  now: Date = new Date()
): Promise<ToolOutcome> {
  const out: ToolOutcome = { log: [], text: '', noBooking: false };
  const facts: string[] = [];
  const record = (name: string, args: Record<string, unknown>, result: string) => {
    out.log.push({ name, args, result });
    facts.push(`${name}: ${result}`);
  };

  const tour = tours.find((t) => t.slug === req.tourSlug);
  const date = req.date && isValidDateString(req.date) ? req.date : undefined;
  const travelers = validTravelers(req.travelers);

  if (intent === 'booking_status') {
    const own = await ownBookings(db, senderPhone, tours);
    record('own_bookings', {}, own.text);
    out.noBooking = !own.found;
  } else if (intent === 'availability') {
    if (!tour || !date) {
      const missing = [!tour && 'which tour', !date && 'which date'].filter(Boolean).join(' and ');
      facts.push(`availability: cannot check yet; ask the guest ${missing}.`);
    } else {
      record('availability', { tour: tour.slug, date, travelers }, await checkAvailability(db, tour, date, travelers, now));
      record('booking_link', { tour: tour.slug, date, travelers }, bookingLink(tour, date, travelers));
    }
  } else if (QUOTE_INTENTS.has(intent) && tour) {
    // Price, deposit, booking and tour questions that name a tour: quote when the
    // group size is known, and always offer the link.
    if (travelers) record('price_quote', { tour: tour.slug, travelers }, await quotePrice(db, tour, travelers));
    record('booking_link', { tour: tour.slug, date, travelers }, bookingLink(tour, date, travelers));
  }

  out.text = facts.join('\n');
  return out;
}
