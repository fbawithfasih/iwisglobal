// Hotel search: what a guest may ask for, the request sent to Hotelbeds, and
// the answer reduced to what the pages show. Pure (no network, no database).

import type { CancellationPolicy } from './hotelPricing';
import { addDays } from './customTrip';

export interface SearchRoom { adults: number; childAges: number[] }
export interface SearchInput { checkIn: string; checkOut: string; rooms: SearchRoom[] }
export type SearchErrorCode = 'bad_dates' | 'too_soon' | 'too_long' | 'bad_rooms' | 'bad_adults' | 'bad_children' | 'bad_age';
export interface SearchError { code: SearchErrorCode; params?: Record<string, string | number> }

export const MAX_ROOMS = 4;
export const MAX_NIGHTS = 14;
export const MAX_ADULTS_PER_ROOM = 4;
export const MAX_CHILDREN_PER_ROOM = 3;
export const MIN_LEAD_DAYS = 1;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const nights = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

// A real calendar date: right shape, and it survives a round trip (rejects 2026-02-30, 2026-13-01, ...).
const isRealDate = (d: string): boolean => {
  if (!DATE.test(d)) return false;
  const t = Date.parse(`${d}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
};

// A count from a posted value: a JS integer, or a 1-2 digit string. Anything else is NaN.
const toCount = (v: unknown): number => {
  if (typeof v === 'number') return Number.isInteger(v) ? v : NaN;
  if (typeof v === 'string' && /^\d{1,2}$/.test(v)) return Number(v);
  return NaN;
};

// Cleans a posted search; null when it is not shaped like one (including a
// child with no usable age: ages are mandatory).
export function parseSearchInput(raw: unknown): SearchInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.checkIn !== 'string' || typeof r.checkOut !== 'string' || !Array.isArray(r.rooms)) return null;
  const rooms: SearchRoom[] = [];
  for (const item of r.rooms.slice(0, 20)) {
    if (!item || typeof item !== 'object') return null;
    const room = item as Record<string, unknown>;
    const adults = toCount(room.adults);
    const ages = Array.isArray(room.childAges) ? room.childAges : [];
    const childAges = ages.map(toCount);
    if (!Number.isInteger(adults) || childAges.some((a) => !Number.isInteger(a))) return null;
    rooms.push({ adults, childAges });
  }
  return { checkIn: r.checkIn, checkOut: r.checkOut, rooms };
}

export function validateSearch(input: SearchInput, today: string): SearchError[] {
  const errors: SearchError[] = [];
  const n = isRealDate(input.checkIn) && isRealDate(input.checkOut) ? nights(input.checkIn, input.checkOut) : NaN;
  if (!(n >= 1)) {
    errors.push({ code: 'bad_dates' });
  } else {
    if (input.checkIn < addDays(today, MIN_LEAD_DAYS)) errors.push({ code: 'too_soon' });
    if (n > MAX_NIGHTS) errors.push({ code: 'too_long', params: { max: MAX_NIGHTS } });
  }
  if (input.rooms.length < 1 || input.rooms.length > MAX_ROOMS) errors.push({ code: 'bad_rooms', params: { max: MAX_ROOMS } });
  for (const room of input.rooms) {
    if (room.adults < 1 || room.adults > MAX_ADULTS_PER_ROOM) errors.push({ code: 'bad_adults', params: { max: MAX_ADULTS_PER_ROOM } });
    if (room.childAges.length > MAX_CHILDREN_PER_ROOM) errors.push({ code: 'bad_children', params: { max: MAX_CHILDREN_PER_ROOM } });
    if (room.childAges.some((a) => a < 0 || a > 17)) errors.push({ code: 'bad_age' });
  }
  return errors;
}

// One request for the whole party. Rooms with the same occupants (and the same
// children's ages) share an occupancy node with a room count; any difference
// gets its own node, as Hotelbeds asks.
export function buildAvailabilityBody(input: SearchInput, hotelCodes: number[]): object {
  const groups = new Map<string, { rooms: number; adults: number; childAges: number[] }>();
  for (const room of input.rooms) {
    const ages = [...room.childAges].sort((a, b) => a - b);
    const key = `${room.adults}|${ages.join(',')}`;
    const g = groups.get(key);
    if (g) g.rooms += 1;
    else groups.set(key, { rooms: 1, adults: room.adults, childAges: ages });
  }
  return {
    stay: { checkIn: input.checkIn, checkOut: input.checkOut },
    occupancies: [...groups.values()].map((g) => ({
      rooms: g.rooms,
      adults: g.adults,
      children: g.childAges.length,
      ...(g.childAges.length ? { paxes: g.childAges.map((age) => ({ type: 'CH', age })) } : {}),
    })),
    hotels: { hotel: hotelCodes.slice(0, 2000) },
  };
}

export interface RateOption {
  rateKey: string;
  rateType: 'BOOKABLE' | 'RECHECK';
  net: number;
  boardCode: string;
  boardName: string;
  roomCode: string;
  roomName: string;
  rooms: number;
  adults: number;
  children: number;
  allotment: number;
  cancellation: CancellationPolicy[];
  rateCommentsId: string | null;
  promotions: string[];
}

export interface HotelResult {
  code: number;
  name: string;
  categoryCode: string;
  categoryName: string;
  currency: string;
  rates: RateOption[];
}

export function parseAvailability(json: any): HotelResult[] {
  const hotels = json?.hotels?.hotels;
  if (!Array.isArray(hotels)) return [];
  const out: HotelResult[] = [];
  for (const h of hotels) {
    const rates: RateOption[] = [];
    for (const room of h.rooms ?? []) {
      for (const rate of room.rates ?? []) {
        const net = Number(rate.net);
        if (!rate.rateKey || !(net > 0) || rate.packaging === true) continue; // opaque/packaged rates are never shown
        if (rate.rateType !== 'BOOKABLE' && rate.rateType !== 'RECHECK') continue;
        rates.push({
          rateKey: String(rate.rateKey),
          rateType: rate.rateType,
          net,
          boardCode: String(rate.boardCode ?? ''),
          boardName: String(rate.boardName ?? ''),
          roomCode: String(room.code ?? ''),
          roomName: String(room.name ?? ''),
          rooms: Number(rate.rooms ?? 1),
          adults: Number(rate.adults ?? 0),
          children: Number(rate.children ?? 0),
          allotment: Number(rate.allotment ?? 0),
          cancellation: (rate.cancellationPolicies ?? []).map((c: any) => ({ amount: Number(c.amount), from: String(c.from) })),
          rateCommentsId: rate.rateCommentsId ? String(rate.rateCommentsId) : null,
          promotions: (rate.promotions ?? []).map((p: any) => String(p.name ?? p.code ?? '')).filter(Boolean),
        });
      }
    }
    if (rates.length) {
      out.push({
        code: Number(h.code),
        name: String(h.name ?? ''),
        categoryCode: String(h.categoryCode ?? ''),
        categoryName: String(h.categoryName ?? ''),
        currency: String(h.currency ?? ''),
        rates,
      });
    }
  }
  return out;
}
