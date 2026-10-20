// Hotelbeds content (names, photos, facilities) copied into D1 so searches never
// wait on the content API. Refreshed weekly by /api/hotels/sync.

import type { D1Like } from './db';
import { hbConfig, hbRequest } from './hotelbeds';
import { loadHotelSettings } from './hotelData';

export interface HotelContent {
  code: number;
  name: string;
  categoryCode: string;
  categoryName: string;
  stars: number;
  address: string;
  postalCode: string;
  city: string;
  phone: string;
  lat: number | null;
  lon: number | null;
  description: string;
  images: { path: string; type: string }[];
  facilities: { code: number; group: number; name: string; paid: boolean; yesOrNo?: boolean }[];
}

export const imageUrl = (path: string): string => 'https://photos.hotelbeds.com/giata/bigger/' + path;

const PAGE_SIZE = 100;

const text = (v: any): string => (typeof v?.content === 'string' ? v.content : '');
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// The hotels list gives each facility as codes only (facilityCode and facilityGroupCode); the words
// come from the Content API "types/facilities" list, keyed here as "<group>:<code>".
export type FacilityNames = Map<string, string>;
const facilityKey = (group: unknown, code: unknown) => `${Number(group) || 0}:${Number(code) || 0}`;

export function parseContentHotel(h: any, names?: FacilityNames): HotelContent | null {
  const code = Number(h?.code);
  const name = text(h?.name).trim();
  if (!Number.isInteger(code) || code <= 0 || !name) return null;

  const categoryCode = typeof h.categoryCode === 'string' ? h.categoryCode : '';
  const stars = Number((categoryCode.match(/^(\d)/) ?? [])[1] ?? 0);
  const categoryName = text(h.category?.description) || (stars > 0 ? `${stars} STARS` : categoryCode);

  const phones: any[] = Array.isArray(h.phones) ? h.phones : [];
  const phone = String((phones.find((p) => p?.phoneType === 'PHONEBOOKING') ?? phones[0])?.phoneNumber ?? '');

  const images = (Array.isArray(h.images) ? h.images : [])
    .filter((i: any) => typeof i?.path === 'string' && i.path)
    .map((i: any) => ({ path: i.path as string, type: String(i.imageTypeCode ?? '') }));

  const facilities: HotelContent['facilities'] = [];
  for (const f of Array.isArray(h.facilities) ? h.facilities : []) {
    const group = Number(f?.facilityGroupCode) || 0;
    const code = Number(f?.facilityCode) || 0;
    const name = text(f?.description) || names?.get(facilityKey(group, code)) || '';
    if (!name) continue;
    // Mandatory facilities carry indYesOrNo, the others indLogic: false means the hotel does not have it.
    const present = typeof f.indYesOrNo === 'boolean' ? f.indYesOrNo : typeof f.indLogic === 'boolean' ? f.indLogic : undefined;
    if (present === false) continue;
    const item: HotelContent['facilities'][number] = { code, group, name, paid: f.indFee === true };
    if (present !== undefined) item.yesOrNo = present;
    facilities.push(item);
  }

  return {
    code,
    name,
    categoryCode,
    categoryName,
    stars,
    address: text(h.address),
    postalCode: typeof h.postalCode === 'string' ? h.postalCode : '',
    city: text(h.city),
    phone,
    lat: numOrNull(h.coordinates?.latitude),
    lon: numOrNull(h.coordinates?.longitude),
    description: text(h.description),
    images,
    facilities,
  };
}

// Facility words for the whole catalogue, paged 1000 at a time. Null when the lookup fails, so a sync
// never overwrites stored facilities with empty ones.
export async function fetchFacilityNames(cfg: ReturnType<typeof hbConfig> & {}): Promise<FacilityNames | null> {
  const names: FacilityNames = new Map();
  let from = 1;
  for (let page = 0; page < 20; page++) {
    let res: { status: number; json: any };
    try {
      res = await hbRequest(cfg, `/hotel-content-api/1.0/types/facilities?fields=all&language=ENG&useSecondaryLanguage=false&from=${from}&to=${from + 999}`, { timeoutMs: 60_000 });
    } catch {
      return null;
    }
    if (res.status !== 200 || !Array.isArray(res.json?.facilities)) return null;
    for (const f of res.json.facilities) {
      const name = text(f?.description);
      if (name) names.set(facilityKey(f?.facilityGroupCode, f?.code ?? f?.facilityCode), name);
    }
    const to = Number(res.json.to);
    const total = Number(res.json.total);
    if (!Number.isFinite(to) || !Number.isFinite(total) || to >= total || to < from) break;
    from = to + 1;
  }
  return names.size > 0 ? names : null;
}

async function recordFailure(db: D1Like, error: string): Promise<{ ok: false; error: string }> {
  await db
    .prepare('UPDATE hotel_sync SET last_error = ? WHERE id = 1')
    .bind(error.slice(0, 500))
    .run();
  return { ok: false, error };
}

async function upsert(db: D1Like, h: HotelContent, now: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO hotel_content (code, name, category_code, category_name, stars, address, postal_code, city, phone, lat, lon, description, images_json, facilities_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET
         name = excluded.name, category_code = excluded.category_code, category_name = excluded.category_name,
         stars = excluded.stars, address = excluded.address, postal_code = excluded.postal_code, city = excluded.city,
         phone = excluded.phone, lat = excluded.lat, lon = excluded.lon, description = excluded.description,
         images_json = excluded.images_json, facilities_json = excluded.facilities_json, updated_at = excluded.updated_at`
    )
    .bind(
      h.code, h.name, h.categoryCode, h.categoryName, h.stars, h.address, h.postalCode, h.city, h.phone,
      h.lat, h.lon, h.description, JSON.stringify(h.images), JSON.stringify(h.facilities), now
    )
    .run();
}

export async function syncHotelContent(
  env: Record<string, any>,
  db: D1Like
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const cfg = hbConfig(env);
  if (!cfg) return { ok: false, error: 'Hotelbeds keys are not configured.' };

  const settings = await loadHotelSettings(db);
  const now = new Date().toISOString();
  let count = 0;
  let from = 1;

  const names = await fetchFacilityNames(cfg);
  if (!names) return recordFailure(db, 'Could not read the facility names from the Content API, so nothing was changed.');

  // Rows are only ever inserted or updated, never removed, so a failed run
  // leaves the previous content in place.
  for (;;) {
    let res: { status: number; json: any };
    try {
      res = await hbRequest(
        cfg,
        `/hotel-content-api/1.0/hotels?destinationCode=${encodeURIComponent(settings.destinationCode)}&fields=all&language=ENG&from=${from}&to=${from + PAGE_SIZE - 1}`,
        { timeoutMs: 60_000 }
      );
    } catch (e) {
      return recordFailure(db, `Content request failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (res.status !== 200 || !Array.isArray(res.json?.hotels)) {
      return recordFailure(db, `Content request returned HTTP ${res.status}.`);
    }

    for (const raw of res.json.hotels) {
      const h = parseContentHotel(raw, names);
      if (!h) continue;
      await upsert(db, h, now);
      count++;
    }

    const to = Number(res.json.to);
    const total = Number(res.json.total);
    // Stop at the last page, or if the answer would not move us forward.
    if (!Number.isFinite(to) || !Number.isFinite(total) || to >= total || to < from) break;
    from = to + 1;
  }

  await db
    .prepare('UPDATE hotel_sync SET last_run = ?, last_count = ?, last_error = ? WHERE id = 1')
    .bind(now, count, '')
    .run();
  return { ok: true, count };
}

// Codes that may be offered for sale: at or above the minimum star rating and
// not on the exclusion list.
export async function listHotelCodes(db: D1Like): Promise<number[]> {
  const settings = await loadHotelSettings(db);
  const { results } = await db
    .prepare('SELECT code FROM hotel_content WHERE stars >= ? ORDER BY code')
    .bind(settings.minStars)
    .all<{ code: number }>();
  const excluded = new Set(settings.excludedCodes);
  return results.map((r) => r.code).filter((c) => !excluded.has(c));
}

export async function getHotelContent(db: D1Like, codes: number[]): Promise<Map<number, HotelContent>> {
  const out = new Map<number, HotelContent>();
  // D1 allows at most 100 bound parameters per statement.
  for (let i = 0; i < codes.length; i += 90) {
    const chunk = codes.slice(i, i + 90);
    const { results } = await db
      .prepare(`SELECT * FROM hotel_content WHERE code IN (${chunk.map(() => '?').join(',')})`)
      .bind(...chunk)
      .all<any>();
    for (const r of results) {
      out.set(r.code, {
        code: r.code,
        name: r.name,
        categoryCode: r.category_code,
        categoryName: r.category_name,
        stars: r.stars,
        address: r.address,
        postalCode: r.postal_code,
        city: r.city,
        phone: r.phone,
        lat: r.lat ?? null,
        lon: r.lon ?? null,
        description: r.description,
        images: safeJson(r.images_json),
        facilities: safeJson(r.facilities_json),
      });
    }
  }
  return out;
}

function safeJson(s: string): any[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
