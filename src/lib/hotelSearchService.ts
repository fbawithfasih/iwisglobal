// Hotel search for the /hotels page: validate the party, ask Hotelbeds once,
// price every rate for the guest and remember each shown rate for 30 minutes.
// The response never carries Hotelbeds' net price; that stays server side in
// hotel_rate_cache.

import type { D1Like } from './db';
import { hbConfig, hbRequest } from './hotelbeds';
import { isHotelsEnabled, loadHotelSettings } from './hotelData';
import { getHotelContent, imageUrl, listHotelCodes } from './hotelContent';
import { guestPrice, type GuestCurrency } from './hotelPricing';
import { buildAvailabilityBody, parseAvailability, parseSearchInput, validateSearch } from './hotelSearch';

export interface ShownRate {
  rateKey: string;
  rateType: 'BOOKABLE' | 'RECHECK';
  roomName: string;
  boardName: string;
  price: number;
  perNight: number;
  currency: GuestCurrency;
  freeCancellationUntil: string | null;
  promotions: string[];
  rooms: number;
}

export interface ShownHotel {
  code: number;
  name: string;
  stars: number;
  categoryName: string;
  address: string;
  image: string | null;
  facilities: string[];
  from: number;
  currency: GuestCurrency;
  rates: ShownRate[];
}

export const RATE_CACHE_MINUTES = 30;
const MAX_FACILITIES = 5;
// D1 allows at most 100 bound parameters per query; 3 per row.
const CACHE_ROWS_PER_STATEMENT = 30;
const nightsBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

const unavailable = (status: number) => ({ status, body: { error: 'unavailable' } as Record<string, unknown> });

export async function searchHotels(
  env: Record<string, any>,
  db: D1Like,
  raw: unknown,
  currency: GuestCurrency,
  today: string,
  now: Date = new Date(),
  // A signed-in admin may search while hotels are switched off, to test before launch.
  adminPreview = false
): Promise<{ status: number; body: Record<string, unknown> }> {
  const input = parseSearchInput(raw);
  if (!input) return { status: 400, body: { error: 'bad_request' } };
  const errors = validateSearch(input, today);
  if (errors.length) return { status: 400, body: { error: 'invalid_search', errors } };
  if (!adminPreview && !(await isHotelsEnabled(db))) return { status: 403, body: { error: 'not_available' } };

  const cfg = hbConfig(env);
  if (!cfg) return unavailable(503);
  const codes = await listHotelCodes(db);
  if (!codes.length) return unavailable(503);

  let results;
  try {
    const res = await hbRequest(cfg, '/hotel-api/1.0/hotels', { body: buildAvailabilityBody(input, codes) });
    if (res.status !== 200) return unavailable(502);
    results = parseAvailability(res.json);
  } catch {
    return unavailable(502);
  }

  const nights = nightsBetween(input.checkIn, input.checkOut);
  const settings = await loadHotelSettings(db);
  const content = await getHotelContent(db, results.map((r) => r.code));
  const expiresAt = new Date(now.getTime() + RATE_CACHE_MINUTES * 60_000).toISOString();
  const hotels: ShownHotel[] = [];
  const cacheRows: { rateKey: string; payload: string }[] = [];

  for (const r of results) {
    const info = content.get(r.code);
    if (!info) continue;
    const rates: ShownRate[] = [];
    for (const rate of r.rates) {
      const price = guestPrice(rate.net, r.currency, currency, settings);
      if (price === null || !(price > 0)) continue;
      const first = rate.cancellation[0];
      const freeUntil = first && Date.parse(first.from) > now.getTime() ? first.from : null;
      rates.push({
        rateKey: rate.rateKey,
        rateType: rate.rateType,
        roomName: rate.roomName,
        boardName: rate.boardName,
        price,
        perNight: Math.ceil(price / nights),
        currency,
        freeCancellationUntil: freeUntil,
        promotions: rate.promotions,
        rooms: rate.rooms,
      });
      cacheRows.push({
        rateKey: rate.rateKey,
        payload: JSON.stringify({
          hotelCode: r.code,
          hotelName: info.name,
          roomName: rate.roomName,
          boardName: rate.boardName,
          net: rate.net,
          currency: r.currency,
          cancellation: rate.cancellation,
          rateType: rate.rateType,
          rateCommentsId: rate.rateCommentsId,
          search: input,
        }),
      });
    }
    if (!rates.length) continue;
    rates.sort((a, b) => a.price - b.price);
    hotels.push({
      code: r.code,
      name: info.name,
      stars: info.stars,
      categoryName: info.categoryName || r.categoryName,
      address: info.address,
      image: info.images[0] ? imageUrl(info.images[0].path) : null,
      // Hotelbeds always returns the "mandatory" facilities with indYesOrNo; false means the hotel does not have it.
      facilities: info.facilities.filter((f) => !f.paid && f.yesOrNo !== false).map((f) => f.name).slice(0, MAX_FACILITIES),
      from: rates[0].price,
      currency,
      rates,
    });
  }
  hotels.sort((a, b) => a.from - b.from);

  await db.prepare('DELETE FROM hotel_rate_cache WHERE expires_at < ?').bind(now.toISOString()).run();
  for (let i = 0; i < cacheRows.length; i += CACHE_ROWS_PER_STATEMENT) {
    const chunk = cacheRows.slice(i, i + CACHE_ROWS_PER_STATEMENT);
    await db
      .prepare(`INSERT OR REPLACE INTO hotel_rate_cache (rate_key, payload, expires_at) VALUES ${chunk.map(() => '(?,?,?)').join(',')}`)
      .bind(...chunk.flatMap((row) => [row.rateKey, row.payload, expiresAt]))
      .run();
  }

  return { status: 200, body: { hotels, searchId: crypto.randomUUID(), nights } };
}
