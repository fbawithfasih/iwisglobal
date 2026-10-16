import type { D1Like } from './db';

export interface HotelSettings {
  enabled: boolean;
  markupPercent: number;
  fxEurInr: number;
  fxEurUsd: number;
  contractCurrency: string;
  destinationCode: string;
  minStars: number;
  excludedCodes: number[];
}
type Saved = { ok: true } | { ok: false; error: string };
const bad = (error: string): Saved => ({ ok: false, error });

async function allSettings(db: D1Like): Promise<Record<string, string>> {
  const { results } = await db.prepare(`SELECT key, value FROM hotel_settings`).bind().all<{ key: string; value: string }>();
  return Object.fromEntries(results.map((r) => [r.key, r.value]));
}

export async function loadHotelSettings(db: D1Like): Promise<HotelSettings> {
  const s = await allSettings(db);
  return {
    enabled: s.enabled === '1',
    markupPercent: Number(s.markup_percent) || 0,
    fxEurInr: Number(s.fx_eur_inr) || 0,
    fxEurUsd: Number(s.fx_eur_usd) || 0,
    contractCurrency: s.contract_currency || 'EUR',
    destinationCode: s.destination_code || 'AGR',
    minStars: Number(s.min_stars) || 0,
    excludedCodes: (s.excluded_codes || '').split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0),
  };
}

export async function isHotelsEnabled(db: D1Like): Promise<boolean> {
  return (await loadHotelSettings(db)).enabled;
}

async function put(db: D1Like, key: string, value: string) {
  await db.prepare(`INSERT INTO hotel_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(key, value).run();
}

export async function saveHotelSettings(db: D1Like, input: Record<string, unknown>): Promise<Saved> {
  const markup = Number(input.markupPercent);
  const inr = Number(input.fxEurInr);
  const usd = Number(input.fxEurUsd);
  const stars = Number(input.minStars);
  const codes = String(input.excludedCodes ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!Number.isFinite(markup) || markup < 0 || markup > 200) return bad('Markup must be between 0 and 200 percent.');
  if (!Number.isFinite(inr) || inr < 0 || !Number.isFinite(usd) || usd < 0) return bad('Exchange rates must be positive numbers.');
  if (!Number.isInteger(stars) || stars < 0 || stars > 5) return bad('Minimum stars must be 0 to 5.');
  if (codes.some((c) => !/^\d+$/.test(c))) return bad('Excluded hotel codes must be numbers separated by commas.');
  await put(db, 'markup_percent', String(markup));
  await put(db, 'fx_eur_inr', String(inr));
  await put(db, 'fx_eur_usd', String(usd));
  await put(db, 'min_stars', String(stars));
  await put(db, 'excluded_codes', codes.join(','));
  return { ok: true };
}

export async function setHotelsEnabled(db: D1Like, on: boolean): Promise<Saved> {
  if (on) {
    const s = await loadHotelSettings(db);
    if (s.markupPercent <= 0) return bad('Set a markup percent first.');
    if (s.fxEurInr <= 0) return bad('Set the EUR to INR exchange rate first.');
    const row = await db.prepare(`SELECT COUNT(*) AS n FROM hotel_content`).bind().first<{ n: number }>();
    if (!row?.n) return bad('Load the hotel content first (Refresh content).');
  }
  await put(db, 'enabled', on ? '1' : '0');
  return { ok: true };
}
