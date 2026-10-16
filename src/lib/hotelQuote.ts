// Turn a rate the guest picked into a stored quote. The price always comes from
// the server: the rate cache supplies the Hotelbeds net, a RECHECK rate is
// re-priced with CheckRate, and the price the browser showed (`shownPrice`) is
// only compared to say whether it changed.

import type { D1Like } from './db';
import { fetchRateComments, hbConfig, hbRequest, type HbConfig } from './hotelbeds';
import { isHotelsEnabled, loadHotelSettings } from './hotelData';
import { guestPrice, type CancellationPolicy, type GuestCurrency } from './hotelPricing';
import type { SearchInput } from './hotelSearch';

export interface Quote {
  bookingId: string;
  hotelCode: number;
  hotelName: string;
  roomName: string;
  boardName: string;
  checkIn: string;
  checkOut: string;
  price: number;
  currency: GuestCurrency;
  cancellation: CancellationPolicy[];
  rateComments: string[];
  // True when the rate has comments Hotelbeds should show but the lookup failed.
  commentsUnavailable: boolean;
  changed: boolean;
  rooms: number;
}

const MAX_RATE_KEY = 600;
const result = (status: number, error: string) => ({ status, body: { error } as Record<string, unknown> });

function parsePolicies(raw: unknown): CancellationPolicy[] {
  if (!Array.isArray(raw)) return [];
  const out: CancellationPolicy[] = [];
  for (const p of raw) {
    const amount = Number((p as any)?.amount);
    const from = (p as any)?.from;
    if (Number.isFinite(amount) && amount >= 0 && typeof from === 'string' && from) out.push({ amount, from });
  }
  return out;
}

function parseBody(raw: unknown): { rateKey: string; shownPrice: number; trip: string } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { rateKey, shownPrice, trip } = raw as Record<string, unknown>;
  if (typeof rateKey !== 'string' || !rateKey || rateKey.length > MAX_RATE_KEY) return null;
  if (typeof shownPrice !== 'number' || !Number.isFinite(shownPrice) || shownPrice < 0) return null;
  if (trip !== undefined && typeof trip !== 'string') return null;
  return { rateKey, shownPrice, trip: trip ?? '' };
}

export async function rateHotel(
  env: Record<string, any>,
  db: D1Like,
  raw: unknown,
  currency: GuestCurrency,
  now: Date = new Date()
): Promise<{ status: number; body: Record<string, unknown> }> {
  const input = parseBody(raw);
  if (!input) return result(400, 'bad_request');
  if (!(await isHotelsEnabled(db))) return result(403, 'not_available');

  const row = await db.prepare('SELECT payload, expires_at FROM hotel_rate_cache WHERE rate_key = ?').bind(input.rateKey).first<{ payload: string; expires_at: string }>();
  if (!row || row.expires_at < now.toISOString()) return result(409, 'sold_out');
  let cached: any;
  try {
    cached = JSON.parse(row.payload);
  } catch {
    return result(409, 'sold_out');
  }
  const search = cached?.search as SearchInput | undefined;
  if (!search || !Array.isArray(search.rooms) || !Number.isFinite(Number(cached.net)) || !Number.isFinite(Number(cached.hotelCode))) return result(409, 'sold_out');

  const hotelCode = Number(cached.hotelCode);
  const rateCommentsId: string | null = cached.rateCommentsId ? String(cached.rateCommentsId) : null;
  let net = Number(cached.net);
  let cancellation = parsePolicies(cached.cancellation);
  let rateComments: string[] = [];
  let bookRateKey = input.rateKey;
  let rateType: string = cached.rateType === 'RECHECK' ? 'RECHECK' : 'BOOKABLE';

  const cfg: HbConfig | null = hbConfig(env);

  if (cached.rateType === 'RECHECK') {
    if (!cfg) return result(502, 'unavailable');
    let rate: any;
    try {
      const res = await hbRequest(cfg, '/hotel-api/1.0/checkrates', { body: { rooms: [{ rateKey: input.rateKey }] } });
      // Outages and credential faults are not "sold out"; other 4xx are.
      if (res.status === 401 || res.status === 403 || res.status === 429 || res.status >= 500) return result(502, 'unavailable');
      if (res.status !== 200) return result(409, 'sold_out');
      rate = res.json?.hotel?.rooms?.[0]?.rates?.[0];
    } catch {
      return result(502, 'unavailable');
    }
    const newNet = Number(rate?.net);
    if (!rate || !Number.isFinite(newNet) || newNet < 0) return result(409, 'sold_out');
    net = newNet;
    // The key to book with is the one CheckRate returns, when it returns one.
    if (typeof rate.rateKey === 'string' && rate.rateKey) bookRateKey = rate.rateKey;
    cancellation = parsePolicies(rate.cancellationPolicies);
    rateType = rate.rateType === 'RECHECK' ? 'RECHECK' : 'BOOKABLE';
    const inline = rate.rateComments;
    if (typeof inline === 'string' && inline.trim()) rateComments = [inline];
    else if (Array.isArray(inline)) rateComments = inline.filter((c: unknown): c is string => typeof c === 'string' && c.trim() !== '');
  }

  // A rate that points at Content API comments and has none inline.
  let commentsUnavailable = false;
  if (rateCommentsId && rateComments.length === 0) {
    const texts = cfg ? await fetchRateComments(cfg, rateCommentsId, search.checkIn, hotelCode) : null;
    if (texts === null) commentsUnavailable = true;
    else rateComments = texts;
  }

  const settings = await loadHotelSettings(db);
  const price = guestPrice(net, String(cached.currency), currency, settings);
  if (price === null || !(price > 0)) return result(502, 'unavailable');

  let tripId = '';
  if (input.trip) {
    const trip = await db.prepare('SELECT id FROM custom_trips WHERE id = ?').bind(input.trip).first<{ id: string }>();
    if (trip) tripId = trip.id;
  }

  const hotelName = String(cached.hotelName ?? '');
  const roomName = String(cached.roomName ?? '');
  const boardName = String(cached.boardName ?? '');
  const bookingId = 'hb_' + crypto.randomUUID();
  const stamp = now.toISOString();
  const selected = { rateKey: input.rateKey, bookRateKey, cancellation, boardName, roomName, hotelName, rateCommentsId, rateComments, rateType };
  await db
    .prepare(
      `INSERT INTO hotel_bookings (id, status, currency, hotel_code, search_json, selected_json, net_cost, sell_total, custom_trip_id, created_at, updated_at)
       VALUES (?, 'quoted', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(bookingId, currency, hotelCode, JSON.stringify(search), JSON.stringify(selected), net, price, tripId, stamp, stamp)
    .run();

  const quote: Quote = {
    bookingId,
    hotelCode,
    hotelName,
    roomName,
    boardName,
    checkIn: search.checkIn,
    checkOut: search.checkOut,
    price,
    currency,
    cancellation,
    rateComments,
    commentsUnavailable,
    changed: price !== input.shownPrice,
    rooms: search.rooms.length,
  };
  return { status: 200, body: { quote } };
}
