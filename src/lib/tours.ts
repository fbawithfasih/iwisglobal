// D1-backed tour catalog: lets tours be created/edited from the admin CRM
// (src/pages/admin/tours/*) instead of requiring a code change + redeploy.

import type { D1Like } from './db';
import type { CatalogItem, AddOn, PricingTier } from './catalog';
import { resolvePrice, type Currency } from './currency';

export interface TourRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  description: string;
  duration_label: string;
  start_point: string;
  amount: number;
  usd_amount: number | null;
  currency: string;
  highlights: string;
  itinerary: string;
  includes: string;
  excludes: string;
  image: string;
  featured: number;
  status: string;
  guide_language: string;
  pickup_included: number;
  private_tour: number;
  created_at: string;
  updated_at: string;
}

export interface ItineraryStep {
  time: string;
  activity: string;
}

export interface ParsedTour {
  id: string;
  slug: string;
  title: string;
  summary: string;
  description: string;
  durationLabel: string;
  startPoint: string;
  amount: number;
  usdAmount: number | null;
  currency: string;
  highlights: string[];
  itinerary: ItineraryStep[];
  includes: string[];
  excludes: string[];
  image: string;
  featured: boolean;
  status: string;
  guideLanguage: string;
  pickupIncluded: boolean;
  privateTour: boolean;
  createdAt: string;
  updatedAt: string;
  addOns: AddOn[];
  pricingTiers: PricingTier[];
}

function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

interface AddOnRow {
  id: string;
  name: string;
  amount: number;
  usdAmount: number | null;
  includedByDefault: number; // D1 stores 0/1
  perTraveler: number; // D1 stores 0/1
}

async function loadAddOns(db: D1Like, tourId: string): Promise<AddOn[]> {
  const { results } = await db
    .prepare(
      `SELECT id, name, amount, usd_amount as usdAmount, included_by_default as includedByDefault, per_traveler as perTraveler
       FROM tour_addons WHERE tour_id = ? ORDER BY created_at ASC`
    )
    .bind(tourId)
    .all<AddOnRow>();
  // Coerce 0/1 to boolean like every other flag column in this file
  // (featured, pickup_included, ...).
  return results.map((r) => ({ ...r, includedByDefault: !!r.includedByDefault, perTraveler: !!r.perTraveler }));
}

async function loadPricingTiers(db: D1Like, tourId: string): Promise<PricingTier[]> {
  const { results } = await db
    .prepare(
      `SELECT travelers, amount, usd_amount as usdAmount
       FROM tour_pricing_tiers WHERE tour_id = ? ORDER BY travelers ASC`
    )
    .bind(tourId)
    .all<PricingTier>();
  return results;
}

async function parseTour(db: D1Like, row: TourRow): Promise<ParsedTour> {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    description: row.description,
    durationLabel: row.duration_label,
    startPoint: row.start_point,
    amount: row.amount,
    usdAmount: row.usd_amount,
    currency: row.currency,
    highlights: safeJsonParse(row.highlights, []),
    itinerary: safeJsonParse(row.itinerary, []),
    includes: safeJsonParse(row.includes, []),
    excludes: safeJsonParse(row.excludes, []),
    image: row.image,
    featured: !!row.featured,
    status: row.status,
    guideLanguage: row.guide_language,
    pickupIncluded: !!row.pickup_included,
    privateTour: !!row.private_tour,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    addOns: await loadAddOns(db, row.id),
    pricingTiers: await loadPricingTiers(db, row.id),
  };
}

export interface TourFilters {
  status?: string;
}

export async function listTours(db: D1Like, filters: TourFilters = {}): Promise<ParsedTour[]> {
  const where = filters.status ? 'WHERE status = ?' : '';
  const { results } = await db
    .prepare(`SELECT * FROM tours ${where} ORDER BY featured DESC, created_at DESC`)
    .bind(...(filters.status ? [filters.status] : []))
    .all<TourRow>();
  return Promise.all(results.map((row) => parseTour(db, row)));
}

export async function getTourById(db: D1Like, id: string): Promise<ParsedTour | null> {
  const row = await db.prepare(`SELECT * FROM tours WHERE id = ?`).bind(id).first<TourRow>();
  return row ? parseTour(db, row) : null;
}

export async function getTourBySlug(db: D1Like, slug: string): Promise<ParsedTour | null> {
  const row = await db.prepare(`SELECT * FROM tours WHERE slug = ?`).bind(slug).first<TourRow>();
  return row ? parseTour(db, row) : null;
}

// The server-side price lookup payment routes rely on — never trust a price
// from the client. By default only published tours can start a new order;
// verify-payment passes onlyPublished:false since an already-created order
// must still be honored even if the tour was unpublished in the meantime.
export async function getCatalogItem(
  db: D1Like,
  tourId: unknown,
  opts: { onlyPublished?: boolean; currency?: Currency } = {}
): Promise<CatalogItem | null> {
  if (typeof tourId !== 'string') return null;
  const onlyPublished = opts.onlyPublished ?? true;
  const row = onlyPublished
    ? await db.prepare(`SELECT amount, usd_amount, currency FROM tours WHERE id = ? AND status = 'published'`).bind(tourId).first<{ amount: number; usd_amount: number | null; currency: string }>()
    : await db.prepare(`SELECT amount, usd_amount, currency FROM tours WHERE id = ?`).bind(tourId).first<{ amount: number; usd_amount: number | null; currency: string }>();
  if (!row) return null;

  const requested = opts.currency ?? 'INR';
  const resolved = resolvePrice({ amount: row.amount, usdAmount: row.usd_amount }, requested);
  const allAddOns = await loadAddOns(db, tourId);
  // Add-ons must match the resolved currency exactly — never mix currencies
  // in one order. An add-on without a USD price is simply unavailable when
  // paying in USD, rather than silently charging it in INR alongside a USD
  // total.
  const addOns =
    resolved.currency === 'USD'
      ? allAddOns
          .filter((a) => a.usdAmount != null)
          .map((a) => ({ id: a.id, name: a.name, amount: a.usdAmount as number, includedByDefault: a.includedByDefault, perTraveler: a.perTraveler }))
      : allAddOns.map((a) => ({ id: a.id, name: a.name, amount: a.amount, includedByDefault: a.includedByDefault, perTraveler: a.perTraveler }));

  // Same per-row currency fallback as add-ons: a tier without a USD price is
  // left out (not mixed in) when paying in USD — computeTotal then falls
  // back to the flat `resolved.amount` for that traveler count, same as a
  // tour with no tiers at all.
  const allTiers = await loadPricingTiers(db, tourId);
  const pricingTiers =
    resolved.currency === 'USD'
      ? allTiers.filter((t) => t.usdAmount != null).map((t) => ({ travelers: t.travelers, amount: t.usdAmount as number }))
      : allTiers.map((t) => ({ travelers: t.travelers, amount: t.amount }));

  return { amount: resolved.amount, currency: resolved.currency, addOns, pricingTiers };
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function toId(title: string): string {
  return title
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/(^_|_$)/g, '');
}

async function uniqueSlugAndId(db: D1Like, title: string): Promise<{ id: string; slug: string }> {
  const baseSlug = slugify(title) || 'tour';
  const baseId = toId(title) || 'TOUR';
  let slug = baseSlug;
  let id = baseId;
  let suffix = 2;
  while (await getTourBySlug(db, slug)) {
    slug = `${baseSlug}-${suffix}`;
    id = `${baseId}_${suffix}`;
    suffix++;
  }
  return { id, slug };
}

export interface TourInput {
  title: string;
  summary: string;
  description: string;
  durationLabel: string;
  startPoint: string;
  amount: number;
  usdAmount: number | null;
  currency: string;
  highlights: string[];
  itinerary: ItineraryStep[];
  includes: string[];
  excludes: string[];
  image: string;
  featured: boolean;
  guideLanguage: string;
  pickupIncluded: boolean;
  privateTour: boolean;
}

export async function createTour(db: D1Like, input: TourInput): Promise<string> {
  const { id, slug } = await uniqueSlugAndId(db, input.title);
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO tours
        (id, slug, title, summary, description, duration_label, start_point, amount, usd_amount, currency,
         highlights, itinerary, includes, excludes, image, featured, guide_language,
         pickup_included, private_tour, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?)`
    )
    .bind(
      id,
      slug,
      input.title,
      input.summary,
      input.description,
      input.durationLabel,
      input.startPoint,
      input.amount,
      input.usdAmount,
      input.currency,
      JSON.stringify(input.highlights),
      JSON.stringify(input.itinerary),
      JSON.stringify(input.includes),
      JSON.stringify(input.excludes),
      input.image,
      input.featured ? 1 : 0,
      input.guideLanguage,
      input.pickupIncluded ? 1 : 0,
      input.privateTour ? 1 : 0,
      now,
      now
    )
    .run();
  return id;
}

export async function updateTour(db: D1Like, id: string, input: TourInput): Promise<void> {
  await db
    .prepare(
      `UPDATE tours SET
         title = ?, summary = ?, description = ?, duration_label = ?, start_point = ?,
         amount = ?, usd_amount = ?, currency = ?, highlights = ?, itinerary = ?, includes = ?, excludes = ?,
         image = ?, featured = ?, guide_language = ?, pickup_included = ?, private_tour = ?,
         updated_at = ?
       WHERE id = ?`
    )
    .bind(
      input.title,
      input.summary,
      input.description,
      input.durationLabel,
      input.startPoint,
      input.amount,
      input.usdAmount,
      input.currency,
      JSON.stringify(input.highlights),
      JSON.stringify(input.itinerary),
      JSON.stringify(input.includes),
      JSON.stringify(input.excludes),
      input.image,
      input.featured ? 1 : 0,
      input.guideLanguage,
      input.pickupIncluded ? 1 : 0,
      input.privateTour ? 1 : 0,
      new Date().toISOString(),
      id
    )
    .run();
}

export async function setTourStatus(db: D1Like, id: string, status: 'published' | 'draft'): Promise<void> {
  await db.prepare(`UPDATE tours SET status = ?, updated_at = ? WHERE id = ?`).bind(status, new Date().toISOString(), id).run();
}

export async function replaceAddOns(db: D1Like, tourId: string, addOns: AddOn[]): Promise<void> {
  await db.prepare(`DELETE FROM tour_addons WHERE tour_id = ?`).bind(tourId).run();
  const now = new Date().toISOString();
  for (const addOn of addOns) {
    await db
      .prepare(
        `INSERT INTO tour_addons (id, tour_id, name, amount, usd_amount, included_by_default, per_traveler, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        addOn.id,
        tourId,
        addOn.name,
        addOn.amount,
        addOn.usdAmount ?? null,
        addOn.includedByDefault ? 1 : 0,
        addOn.perTraveler ? 1 : 0,
        now
      )
      .run();
  }
}

// Mirrors replaceAddOns: full delete-then-insert of a tour's pricing tiers,
// so the admin form can just submit "the current set" without diffing.
export async function replacePricingTiers(db: D1Like, tourId: string, tiers: PricingTier[]): Promise<void> {
  await db.prepare(`DELETE FROM tour_pricing_tiers WHERE tour_id = ?`).bind(tourId).run();
  const now = new Date().toISOString();
  for (const tier of tiers) {
    await db
      .prepare(
        `INSERT INTO tour_pricing_tiers (id, tour_id, travelers, amount, usd_amount, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(`TIER_${tourId}_${tier.travelers}`, tourId, tier.travelers, tier.amount, tier.usdAmount ?? null, now)
      .run();
  }
}
