// Database side of "Customise your Agra tour" (schema_custom_trips.sql): load
// the rates the price function needs, and the saves behind /admin/custom-trips.
// Prices live here and are edited by the owner; the price rules are in
// customTrip.ts.

import type { D1Like } from './db';
import { TRAVELLER_CATEGORIES, type CustomRates, type CustomStop, type CustomVehicle, type Money, type StopFee, type TravellerCategory } from './customTrip';

const MAX_RATE = 10_000_000;

interface VehicleRow {
  id: string;
  name: string;
  seats: number;
  agra_day_inr: number;
  agra_day_usd: number | null;
  delhi_return_inr: number;
  delhi_return_usd: number | null;
  active: number;
}
interface StopRow {
  id: string;
  name: string;
  attraction_slug: string;
  visit_minutes: number;
  travel_minutes: number;
  closed_fridays: number;
  night_only: number;
  active: number;
}
interface FeeRow {
  stop_id: string;
  category: string;
  fee_inr: number;
  friday_inr: number | null;
  after_taj_inr: number | null;
  checked_on: string;
}

const money = (inr: number, usd: number | null): Money => ({ inr, usd });

async function settingsMap(db: D1Like): Promise<Map<string, string>> {
  const { results } = await db.prepare(`SELECT key, value FROM custom_settings`).bind().all<{ key: string; value: string }>();
  return new Map(results.map((r) => [r.key, r.value]));
}

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? n : fallback;
};

// Every rate the price function needs, in one read (a handful of tiny tables).
export async function loadRates(db: D1Like): Promise<CustomRates> {
  const settings = await settingsMap(db);
  const { results: vehicleRows } = await db.prepare(`SELECT * FROM custom_vehicles ORDER BY sort, id`).bind().all<VehicleRow>();
  const { results: stopRows } = await db.prepare(`SELECT * FROM custom_stops ORDER BY sort, name`).bind().all<StopRow>();
  const { results: feeRows } = await db.prepare(`SELECT * FROM custom_stop_fees`).bind().all<FeeRow>();

  const feesByStop = new Map<string, Partial<Record<TravellerCategory, StopFee>>>();
  for (const f of feeRows) {
    if (!TRAVELLER_CATEGORIES.includes(f.category as TravellerCategory)) continue;
    const row = feesByStop.get(f.stop_id) ?? {};
    row[f.category as TravellerCategory] = { fee: f.fee_inr, friday: f.friday_inr, afterTaj: f.after_taj_inr, checkedOn: f.checked_on };
    feesByStop.set(f.stop_id, row);
  }

  const vehicles: CustomVehicle[] = vehicleRows.map((v) => ({
    id: v.id,
    name: v.name,
    seats: v.seats,
    agraDay: money(v.agra_day_inr, v.agra_day_usd),
    delhiReturn: money(v.delhi_return_inr, v.delhi_return_usd),
    active: !!v.active,
  }));
  const stops: CustomStop[] = stopRows.map((s) => ({
    id: s.id,
    name: s.name,
    attractionSlug: s.attraction_slug,
    visitMinutes: s.visit_minutes,
    travelMinutes: s.travel_minutes,
    closedFridays: !!s.closed_fridays,
    nightOnly: !!s.night_only,
    active: !!s.active,
    fees: feesByStop.get(s.id) ?? {},
  }));

  const guideUsd = num(settings.get('guide_day_usd'), 0);
  return {
    enabled: settings.get('enabled') === '1',
    vehicles,
    stops,
    guideDay: money(num(settings.get('guide_day_inr'), 0), guideUsd > 0 ? guideUsd : null),
    maxDays: Math.max(1, Math.round(num(settings.get('max_days'), 7))),
    dayMinutes: Math.max(60, Math.round(num(settings.get('day_minutes'), 600))),
    usdRate: Math.max(1, num(settings.get('usd_rate'), 96)),
  };
}

export async function isCustomEnabled(db: D1Like): Promise<boolean> {
  const row = await db.prepare(`SELECT value FROM custom_settings WHERE key = 'enabled'`).bind().first<{ value: string }>();
  return row?.value === '1';
}

const whole = (n: unknown, min: number, max: number): number | null => {
  const v = typeof n === 'string' ? Number(n) : n;
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null;
};
// Optional whole number: blank means "not set" (null).
const optional = (n: unknown, min: number, max: number): number | null | undefined => {
  if (n === '' || n === null || n === undefined) return null;
  const v = whole(n, min, max);
  return v === null ? undefined : v;
};

type Saved = { ok: true } | { ok: false; error: string };
const bad = (error: string): Saved => ({ ok: false, error });

async function setSetting(db: D1Like, key: string, value: string) {
  await db.prepare(`INSERT INTO custom_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(key, value).run();
}

export async function saveSettings(
  db: D1Like,
  input: { guideDayInr: unknown; guideDayUsd: unknown; maxDays: unknown; dayMinutes: unknown; usdRate: unknown }
): Promise<Saved> {
  const guideInr = whole(input.guideDayInr, 0, MAX_RATE);
  const guideUsd = optional(input.guideDayUsd, 0, MAX_RATE);
  const maxDays = whole(input.maxDays, 1, 30);
  const dayMinutes = whole(input.dayMinutes, 60, 1440);
  const usdRate = whole(input.usdRate, 1, 1000);
  if (guideInr === null) return bad('The guide day rate must be a whole number of rupees.');
  if (guideUsd === undefined) return bad('The guide day rate in dollars must be a whole number, or blank.');
  if (maxDays === null) return bad('Maximum days must be between 1 and 30.');
  if (dayMinutes === null) return bad('Minutes in a day must be between 60 and 1440.');
  if (usdRate === null) return bad('Rupees per dollar must be a whole number.');
  await setSetting(db, 'guide_day_inr', String(guideInr));
  await setSetting(db, 'guide_day_usd', guideUsd === null ? '' : String(guideUsd));
  await setSetting(db, 'max_days', String(maxDays));
  await setSetting(db, 'day_minutes', String(dayMinutes));
  await setSetting(db, 'usd_rate', String(usdRate));
  return { ok: true };
}

// What still has to be set before guests can see the page.
export async function enableBlockers(db: D1Like): Promise<string[]> {
  const rates = await loadRates(db);
  const blockers: string[] = [];
  if (rates.guideDay.inr <= 0) blockers.push('Set the guide day rate.');
  const live = rates.vehicles.filter((v) => v.active && v.agraDay.inr > 0);
  if (live.length === 0) blockers.push('Switch on at least one vehicle and give it an Agra day rate.');
  if (!rates.stops.some((s) => s.active)) blockers.push('Switch on at least one stop.');
  return blockers;
}

export async function setEnabled(db: D1Like, on: boolean): Promise<Saved> {
  if (on) {
    const blockers = await enableBlockers(db);
    if (blockers.length > 0) return bad(blockers.join(' '));
  }
  await setSetting(db, 'enabled', on ? '1' : '0');
  return { ok: true };
}

export async function saveVehicle(
  db: D1Like,
  id: string,
  input: { seats: unknown; agraDayInr: unknown; agraDayUsd: unknown; delhiReturnInr: unknown; delhiReturnUsd: unknown; active: boolean }
): Promise<Saved> {
  const seats = whole(input.seats, 1, 60);
  const agraInr = whole(input.agraDayInr, 0, MAX_RATE);
  const agraUsd = optional(input.agraDayUsd, 0, MAX_RATE);
  const delhiInr = whole(input.delhiReturnInr, 0, MAX_RATE);
  const delhiUsd = optional(input.delhiReturnUsd, 0, MAX_RATE);
  if (seats === null) return bad('Seats must be between 1 and 60.');
  if (agraInr === null || delhiInr === null) return bad('Rates must be whole numbers of rupees.');
  if (agraUsd === undefined || delhiUsd === undefined) return bad('Dollar rates must be whole numbers, or blank.');
  if (input.active && agraInr <= 0) return bad('Give the vehicle an Agra day rate before switching it on.');
  const r = await db
    .prepare(
      `UPDATE custom_vehicles SET seats = ?, agra_day_inr = ?, agra_day_usd = ?, delhi_return_inr = ?, delhi_return_usd = ?, active = ? WHERE id = ?`
    )
    .bind(seats, agraInr, agraUsd, delhiInr, delhiUsd, input.active ? 1 : 0, id)
    .run();
  return r.meta?.changes ? { ok: true } : bad('That vehicle was not found.');
}

export async function saveStop(
  db: D1Like,
  id: string,
  input: { visitMinutes: unknown; travelMinutes: unknown; closedFridays: boolean; nightOnly: boolean; active: boolean }
): Promise<Saved> {
  const visit = whole(input.visitMinutes, 0, 1440);
  const travel = whole(input.travelMinutes, 0, 1440);
  if (visit === null || travel === null) return bad('Minutes must be whole numbers.');
  const r = await db
    .prepare(`UPDATE custom_stops SET visit_minutes = ?, travel_minutes = ?, closed_fridays = ?, night_only = ?, active = ? WHERE id = ?`)
    .bind(visit, travel, input.closedFridays ? 1 : 0, input.nightOnly ? 1 : 0, input.active ? 1 : 0, id)
    .run();
  return r.meta?.changes ? { ok: true } : bad('That stop was not found.');
}

const slugOf = (name: string) =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

// A stop the owner adds (for example Sikandra). It has no ticket fees until
// they are added, which the price function treats as a free stop.
export async function addStop(db: D1Like, name: string, attractionSlug: string): Promise<Saved> {
  const clean = name.trim().slice(0, 80);
  const id = slugOf(clean);
  if (!clean || !id) return bad('Give the stop a name.');
  const exists = await db.prepare(`SELECT id FROM custom_stops WHERE id = ?`).bind(id).first();
  if (exists) return bad('A stop with that name already exists.');
  const last = await db.prepare(`SELECT COALESCE(MAX(sort), 0) AS s FROM custom_stops`).bind().first<{ s: number }>();
  await db
    .prepare(`INSERT INTO custom_stops (id, name, attraction_slug, sort) VALUES (?, ?, ?, ?)`)
    .bind(id, clean, slugOf(attractionSlug), (last?.s ?? 0) + 1)
    .run();
  return { ok: true };
}

// Makes a stop free (no ticket): a stop with fees for only some traveller types
// cannot be priced, so the owner clears them all instead.
export async function clearStopFees(db: D1Like, stopId: string): Promise<Saved> {
  await db.prepare(`DELETE FROM custom_stop_fees WHERE stop_id = ?`).bind(stopId).run();
  return { ok: true };
}

// today is the date to record as "checked on".
export async function saveStopFee(
  db: D1Like,
  stopId: string,
  category: string,
  input: { fee: unknown; friday: unknown; afterTaj: unknown },
  today: string
): Promise<Saved> {
  if (!TRAVELLER_CATEGORIES.includes(category as TravellerCategory)) return bad('Unknown traveller type.');
  const stop = await db.prepare(`SELECT id FROM custom_stops WHERE id = ?`).bind(stopId).first();
  if (!stop) return bad('That stop was not found.');
  const fee = whole(input.fee, 0, MAX_RATE);
  const friday = optional(input.friday, 0, MAX_RATE);
  const afterTaj = optional(input.afterTaj, 0, MAX_RATE);
  if (fee === null) return bad('The fee must be a whole number of rupees.');
  if (friday === undefined || afterTaj === undefined) return bad('The Friday and after-Taj fees must be whole numbers, or blank.');
  await db
    .prepare(
      `INSERT INTO custom_stop_fees (stop_id, category, fee_inr, friday_inr, after_taj_inr, checked_on) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(stop_id, category) DO UPDATE SET fee_inr = excluded.fee_inr, friday_inr = excluded.friday_inr, after_taj_inr = excluded.after_taj_inr, checked_on = excluded.checked_on`
    )
    .bind(stopId, category, fee, friday, afterTaj, today)
    .run();
  return { ok: true };
}
