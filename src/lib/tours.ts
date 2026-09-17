// D1-backed tour catalog: lets tours be created/edited from the admin CRM
// (src/pages/admin/tours/*) instead of requiring a code change + redeploy.

import type { D1Like } from './db';
import type { CatalogItem, AddOn } from './catalog';

export interface TourRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  description: string;
  duration_label: string;
  start_point: string;
  amount: number;
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
}

function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

async function loadAddOns(db: D1Like, tourId: string): Promise<AddOn[]> {
  const { results } = await db
    .prepare(`SELECT id, name, amount FROM tour_addons WHERE tour_id = ? ORDER BY created_at ASC`)
    .bind(tourId)
    .all<AddOn>();
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
  opts: { onlyPublished?: boolean } = {}
): Promise<CatalogItem | null> {
  if (typeof tourId !== 'string') return null;
  const onlyPublished = opts.onlyPublished ?? true;
  const row = onlyPublished
    ? await db.prepare(`SELECT amount, currency FROM tours WHERE id = ? AND status = 'published'`).bind(tourId).first<{ amount: number; currency: string }>()
    : await db.prepare(`SELECT amount, currency FROM tours WHERE id = ?`).bind(tourId).first<{ amount: number; currency: string }>();
  if (!row) return null;
  return { amount: row.amount, currency: row.currency, addOns: await loadAddOns(db, tourId) };
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
        (id, slug, title, summary, description, duration_label, start_point, amount, currency,
         highlights, itinerary, includes, excludes, image, featured, guide_language,
         pickup_included, private_tour, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?)`
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
         amount = ?, currency = ?, highlights = ?, itinerary = ?, includes = ?, excludes = ?,
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
      .prepare(`INSERT INTO tour_addons (id, tour_id, name, amount, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(addOn.id, tourId, addOn.name, addOn.amount, now)
      .run();
  }
}
