// "Customise your Agra tour": the types, the validation rules and the price
// function. Pure, and free of server-only code, so the builder page can show a
// live estimate with exactly the rules the server later charges by. The server
// never trusts a total from the browser: it calls priceTrip again with the
// saved rates (src/lib/customTripData.ts).
//
// A trip is a run of consecutive days from a start date. Each day has a list of
// stops. The price is:
//   vehicle  — the chosen vehicle's Agra day rate for each day; a start in Delhi
//              charges its Delhi round-trip rate on the first day instead
//   guide    — one guide day rate for each day
//   tickets  — the official ASI fee for each stop, per adult, by category
//              (children under 15 are free)

import { isFriday, isValidDateString, getAvailability } from './availability';
import { isNightViewingDate } from './nightViewing';
import { computeDepositAmount } from './catalog';
import { AGRA_HOTELS } from './agraHotels';

export type Currency = 'INR' | 'USD';
export type TravellerCategory = 'foreign' | 'indian' | 'saarc';
export const TRAVELLER_CATEGORIES: TravellerCategory[] = ['foreign', 'indian', 'saarc'];
export type StartPoint = 'agra' | 'delhi';

export const TAJ_STOP_ID = 'taj-mahal';
export const MAX_STOPS_PER_DAY = 6;
export const MAX_HOTEL_NIGHTS = 30;
export const MAX_HOTEL_ROOMS = 10;
export const MAX_NOTES_LENGTH = 500;

// A rate in rupees, with an optional dollar rate (null: convert at usdRate).
export interface Money {
  inr: number;
  usd: number | null;
}

export interface CustomVehicle {
  id: string;
  name: string;
  seats: number;
  agraDay: Money;
  delhiReturn: Money;
  active: boolean;
}

export interface StopFee {
  fee: number;
  friday: number | null;
  afterTaj: number | null;
  checkedOn: string;
}

export interface CustomStop {
  id: string;
  name: string;
  attractionSlug: string;
  visitMinutes: number;
  travelMinutes: number;
  closedFridays: boolean;
  nightOnly: boolean;
  active: boolean;
  fees: Partial<Record<TravellerCategory, StopFee>>;
}

export interface CustomRates {
  enabled: boolean;
  vehicles: CustomVehicle[];
  stops: CustomStop[];
  guideDay: Money;
  maxDays: number;
  dayMinutes: number;
  usdRate: number;
}

export interface HotelChoice {
  mode: 'own' | 'listed' | 'arrange';
  name?: string;
  nights?: number;
  rooms?: number;
  notes?: string;
}

export interface TripInput {
  startDate: string;
  start: StartPoint;
  travellers: { foreign: number; indian: number; saarc: number; children: number };
  vehicleId: string;
  days: { stopIds: string[] }[];
  hotel: HotelChoice;
  currency: Currency;
}

export type TripErrorCode =
  | 'bad_start_date'
  | 'start_too_soon'
  | 'bad_days'
  | 'too_many_days'
  | 'bad_travellers'
  | 'group_too_large'
  | 'unknown_vehicle'
  | 'vehicle_too_small'
  | 'rates_not_set'
  | 'day_empty'
  | 'too_many_stops'
  | 'unknown_stop'
  | 'duplicate_stop'
  | 'closed_friday'
  | 'night_only'
  | 'day_too_full'
  | 'fee_missing'
  | 'bad_hotel';

export interface TripError {
  code: TripErrorCode;
  message: string; // English, for logs and API callers; the page translates from code + params
  day?: number; // 0-based
  stopId?: string;
  params?: Record<string, string | number>; // day (1-based), stop, vehicle, seats, max
}

export interface TicketLine {
  category: TravellerCategory;
  quantity: number;
  unit: number; // in the quote's currency
  amount: number;
}

export interface QuoteStop {
  id: string;
  name: string;
  tickets: TicketLine[];
}

export interface QuoteDay {
  index: number;
  date: string;
  vehicleAmount: number;
  guideAmount: number;
  ticketAmount: number;
  stops: QuoteStop[];
}

export interface TripQuote {
  currency: Currency;
  startDate: string;
  endDate: string;
  vehicle: { id: string; name: string; seats: number };
  travellers: TripInput['travellers'];
  days: QuoteDay[];
  vehicleTotal: number;
  guideTotal: number;
  ticketsTotal: number;
  total: number;
  deposit: number;
  balance: number;
  ticketFeesCheckedOn: string; // the oldest checked_on among the fees used ('' if no tickets)
}

export type PriceResult = { ok: true; quote: TripQuote } | { ok: false; errors: TripError[] };

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function travellerTotal(t: TripInput['travellers']): number {
  return t.foreign + t.indian + t.saarc + t.children;
}

export function maxSeats(rates: CustomRates): number {
  return rates.vehicles.filter((v) => v.active).reduce((max, v) => Math.max(max, v.seats), 0);
}

// A rate in the guest's currency. A missing dollar rate is the rupee rate at
// the usd_rate setting, rounded up to whole dollars.
function pick(money: Money, currency: Currency, usdRate: number): number {
  if (currency === 'INR') return money.inr;
  return money.usd !== null && money.usd > 0 ? money.usd : Math.ceil(money.inr / usdRate);
}

const err = (code: TripErrorCode, message: string, extra: { day?: number; stopId?: string; params?: TripError['params'] } = {}): TripError => ({ code, message, ...extra });

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

// Everything a trip must satisfy. Never throws; returns every problem found so
// the page can show them all at once.
export function validateTrip(input: TripInput, rates: CustomRates, now: Date = new Date()): TripError[] {
  const errors: TripError[] = [];

  if (!isValidDateString(input.startDate)) {
    errors.push(err('bad_start_date', 'Please choose a valid start date.'));
  } else if (input.startDate < getAvailability(now).minBookableDate) {
    errors.push(err('start_too_soon', 'Please choose a later start date.'));
  }

  const dayCount = input.days.length;
  if (dayCount < 1) errors.push(err('bad_days', 'Add at least one day.'));
  if (dayCount > rates.maxDays) errors.push(err('too_many_days', `Trips can be up to ${rates.maxDays} days.`, { params: { max: rates.maxDays } }));

  const t = input.travellers;
  const counts = [t.foreign, t.indian, t.saarc, t.children];
  const adults = t.foreign + t.indian + t.saarc;
  if (!counts.every(isCount) || adults < 1) {
    errors.push(err('bad_travellers', 'Add at least one adult traveller.'));
  } else if (travellerTotal(t) > maxSeats(rates)) {
    errors.push(err('group_too_large', 'For a group this size, please contact us.'));
  }

  const vehicle = rates.vehicles.find((v) => v.id === input.vehicleId && v.active);
  if (!vehicle) {
    errors.push(err('unknown_vehicle', 'Please choose a vehicle.'));
  } else {
    if (counts.every(isCount) && travellerTotal(t) > vehicle.seats) {
      errors.push(err('vehicle_too_small', `The ${vehicle.name} seats ${vehicle.seats}. Please choose a larger vehicle.`, { params: { vehicle: vehicle.id, seats: vehicle.seats } }));
    }
    const needsDelhi = input.start === 'delhi';
    if (vehicle.agraDay.inr <= 0 || (needsDelhi && vehicle.delhiReturn.inr <= 0) || rates.guideDay.inr <= 0) {
      errors.push(err('rates_not_set', 'Prices for this trip are not set up yet. Please contact us.'));
    }
  }

  const stopById = new Map(rates.stops.map((s) => [s.id, s]));
  input.days.forEach((day, i) => {
    if (day.stopIds.length === 0) {
      errors.push(err('day_empty', `Day ${i + 1} has no stops. Add one or remove the day.`, { day: i, params: { day: i + 1 } }));
      return;
    }
    if (day.stopIds.length > MAX_STOPS_PER_DAY) {
      errors.push(err('too_many_stops', `Day ${i + 1} has too many stops.`, { day: i, params: { day: i + 1 } }));
    }
    const date = isValidDateString(input.startDate) ? addDays(input.startDate, i) : '';
    const seen = new Set<string>();
    let minutes = 0;
    for (const id of day.stopIds) {
      const stop = stopById.get(id);
      if (!stop || !stop.active) {
        errors.push(err('unknown_stop', `Day ${i + 1} has a stop that is no longer available.`, { day: i, stopId: id, params: { day: i + 1 } }));
        continue;
      }
      if (seen.has(id)) errors.push(err('duplicate_stop', `${stop.name} is listed twice on day ${i + 1}.`, { day: i, stopId: id, params: { day: i + 1, stop: id } }));
      seen.add(id);
      minutes += stop.visitMinutes + stop.travelMinutes;
      if (date && stop.closedFridays && isFriday(date)) {
        errors.push(err('closed_friday', `${stop.name} is closed on Fridays. Move it to another day.`, { day: i, stopId: id, params: { day: i + 1, stop: id } }));
      }
      if (date && stop.nightOnly && !isNightViewingDate(date)) {
        errors.push(err('night_only', `${stop.name} is only possible on the full-moon nights.`, { day: i, stopId: id, params: { day: i + 1, stop: id } }));
      }
    }
    if (minutes > rates.dayMinutes) {
      errors.push(err('day_too_full', `Day ${i + 1} has more than one day can hold. Move a stop to another day.`, { day: i, params: { day: i + 1 } }));
    }
  });

  const hotel = input.hotel;
  const listed = new Set(AGRA_HOTELS.map((h) => h.name));
  const notesOk = !hotel.notes || hotel.notes.length <= MAX_NOTES_LENGTH;
  if (hotel.mode === 'listed') {
    if (!hotel.name || !listed.has(hotel.name) || !notesOk) errors.push(err('bad_hotel', 'Please choose a hotel from the list.'));
  } else if (hotel.mode === 'arrange') {
    const nights = hotel.nights ?? 0;
    const rooms = hotel.rooms ?? 0;
    const nameOk = !hotel.name || listed.has(hotel.name);
    if (!Number.isInteger(nights) || nights < 1 || nights > MAX_HOTEL_NIGHTS || !Number.isInteger(rooms) || rooms < 1 || rooms > MAX_HOTEL_ROOMS || !nameOk || !notesOk) {
      errors.push(err('bad_hotel', 'Please give the number of nights and rooms you need.'));
    }
  } else if (hotel.mode !== 'own') {
    errors.push(err('bad_hotel', 'Please choose a hotel option.'));
  }

  return errors;
}

// Validates, then prices. The one function both the browser preview and the
// server use.
export function priceTrip(input: TripInput, rates: CustomRates, now: Date = new Date()): PriceResult {
  const errors = validateTrip(input, rates, now);
  if (errors.length > 0) return { ok: false, errors };

  const vehicle = rates.vehicles.find((v) => v.id === input.vehicleId && v.active)!;
  const stopById = new Map(rates.stops.map((s) => [s.id, s]));
  const { currency } = input;
  const guideDay = pick(rates.guideDay, currency, rates.usdRate);
  const toCurrency = (inr: number) => (currency === 'USD' ? Math.ceil(inr / rates.usdRate) : inr);

  const feeErrors: TripError[] = [];
  let checkedOn = '';
  const days: QuoteDay[] = input.days.map((day, i) => {
    const date = addDays(input.startDate, i);
    const friday = isFriday(date);
    // The Delhi round-trip rate replaces the first day's Agra day rate.
    const vehicleAmount =
      i === 0 && input.start === 'delhi' ? pick(vehicle.delhiReturn, currency, rates.usdRate) : pick(vehicle.agraDay, currency, rates.usdRate);
    let tajSeen = false;
    const stops: QuoteStop[] = day.stopIds.map((id) => {
      const stop = stopById.get(id)!;
      const tickets: TicketLine[] = [];
      const hasAnyFee = TRAVELLER_CATEGORIES.some((c) => stop.fees[c]);
      if (hasAnyFee) {
        for (const category of TRAVELLER_CATEGORIES) {
          const quantity = input.travellers[category];
          if (quantity === 0) continue;
          const fee = stop.fees[category];
          if (!fee) {
            feeErrors.push(err('fee_missing', `The ticket fee for ${stop.name} is not set up yet. Please contact us.`, { day: i, stopId: id, params: { stop: id } }));
            continue;
          }
          const options = [fee.fee];
          if (friday && fee.friday !== null) options.push(fee.friday);
          if (tajSeen && fee.afterTaj !== null) options.push(fee.afterTaj);
          const unit = toCurrency(Math.min(...options));
          tickets.push({ category, quantity, unit, amount: unit * quantity });
          if (fee.checkedOn && (!checkedOn || fee.checkedOn < checkedOn)) checkedOn = fee.checkedOn;
        }
      }
      if (id === TAJ_STOP_ID) tajSeen = true;
      return { id, name: stop.name, tickets };
    });
    const ticketAmount = stops.reduce((sum, s) => sum + s.tickets.reduce((n, t) => n + t.amount, 0), 0);
    return { index: i, date, vehicleAmount, guideAmount: guideDay, ticketAmount, stops };
  });
  if (feeErrors.length > 0) return { ok: false, errors: feeErrors };

  const vehicleTotal = days.reduce((n, d) => n + d.vehicleAmount, 0);
  const guideTotal = days.reduce((n, d) => n + d.guideAmount, 0);
  const ticketsTotal = days.reduce((n, d) => n + d.ticketAmount, 0);
  const total = vehicleTotal + guideTotal + ticketsTotal;
  const deposit = computeDepositAmount(total);
  return {
    ok: true,
    quote: {
      currency,
      startDate: input.startDate,
      endDate: addDays(input.startDate, days.length - 1),
      vehicle: { id: vehicle.id, name: vehicle.name, seats: vehicle.seats },
      travellers: { ...input.travellers },
      days,
      vehicleTotal,
      guideTotal,
      ticketsTotal,
      total,
      deposit,
      balance: total - deposit,
      ticketFeesCheckedOn: checkedOn,
    },
  };
}

// Cleans whatever the browser posts into a TripInput, or returns null when it
// is not even the right shape. This is the trust boundary: anything that gets
// past it is still checked by validateTrip.
export function parseTripInput(raw: unknown): TripInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
  const count = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 200 ? v : 0);

  if (!Array.isArray(r.days) || r.days.length > 31) return null;
  const days: { stopIds: string[] }[] = [];
  for (const d of r.days) {
    const ids = d && typeof d === 'object' ? (d as Record<string, unknown>).stopIds : null;
    if (!Array.isArray(ids) || ids.length > 20) return null;
    days.push({ stopIds: ids.map((id) => text(id, 60)) });
  }

  const tr = (r.travellers && typeof r.travellers === 'object' ? r.travellers : {}) as Record<string, unknown>;
  const h = (r.hotel && typeof r.hotel === 'object' ? r.hotel : {}) as Record<string, unknown>;
  const mode = h.mode === 'listed' || h.mode === 'arrange' ? h.mode : 'own';
  const hotel: HotelChoice = { mode };
  if (typeof h.name === 'string' && h.name) hotel.name = text(h.name, 120);
  if (mode === 'arrange') {
    hotel.nights = typeof h.nights === 'number' ? h.nights : 0;
    hotel.rooms = typeof h.rooms === 'number' ? h.rooms : 0;
  }
  if (typeof h.notes === 'string' && h.notes) hotel.notes = h.notes.slice(0, MAX_NOTES_LENGTH + 1);

  return {
    startDate: text(r.startDate, 10),
    start: r.start === 'delhi' ? 'delhi' : 'agra',
    travellers: { foreign: count(tr.foreign), indian: count(tr.indian), saarc: count(tr.saarc), children: count(tr.children) },
    vehicleId: text(r.vehicleId, 40),
    days,
    hotel,
    currency: r.currency === 'USD' ? 'USD' : 'INR',
  };
}

// --- Contact details (the same checks the booking form makes) --------------

export interface Contact {
  name: string;
  email: string;
  phone: string; // "+<country code> <number>", as the phone picker produces it
}

export type ContactErrors = Partial<Record<keyof Contact, true>>;

export function validateContact(c: Contact): ContactErrors {
  const errors: ContactErrors = {};
  if (c.name.trim().length < 2 || c.name.length > 100) errors.name = true;
  if (c.email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c.email.trim())) errors.email = true;
  if (!/^\+\d{8,15}$/.test(c.phone.replace(/[\s().-]/g, ''))) errors.phone = true;
  return errors;
}

// Cleans the contact block of a posted request, or null if it is not one.
export function parseContact(raw: unknown): Contact | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  return { name: text(r.name, 101), email: text(r.email, 201), phone: text(r.phone, 40) };
}
