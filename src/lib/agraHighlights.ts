// D1-backed "Top things to do in Agra" list, shown on the homepage carousel
// (src/pages/index.astro) and managed from /admin/agra-highlights — mirrors
// the tours.ts pattern but without a status/publish flag, since these are
// informational cards rather than bookable products.

import type { D1Like } from './db';

export interface AgraHighlightRow {
  id: string;
  name: string;
  description: string;
  image: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface AgraHighlight {
  id: string;
  name: string;
  description: string;
  image: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

function parseRow(row: AgraHighlightRow): AgraHighlight {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    image: row.image || null,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listAgraHighlights(db: D1Like): Promise<AgraHighlight[]> {
  const { results } = await db
    .prepare(`SELECT * FROM agra_highlights ORDER BY sort_order ASC, created_at ASC`)
    .bind()
    .all<AgraHighlightRow>();
  return results.map(parseRow);
}

export async function getAgraHighlightById(db: D1Like, id: string): Promise<AgraHighlight | null> {
  const row = await db.prepare(`SELECT * FROM agra_highlights WHERE id = ?`).bind(id).first<AgraHighlightRow>();
  return row ? parseRow(row) : null;
}

function slugify(name: string): string {
  return name
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/(^_|_$)/g, '');
}

async function uniqueId(db: D1Like, name: string): Promise<string> {
  const base = slugify(name) || 'HIGHLIGHT';
  let id = base;
  let suffix = 2;
  while (await getAgraHighlightById(db, id)) {
    id = `${base}_${suffix}`;
    suffix++;
  }
  return id;
}

export interface AgraHighlightInput {
  name: string;
  description: string;
  image: string;
  sortOrder: number;
}

export async function createAgraHighlight(db: D1Like, input: AgraHighlightInput): Promise<string> {
  const id = await uniqueId(db, input.name);
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO agra_highlights (id, name, description, image, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, input.name, input.description, input.image, input.sortOrder, now, now)
    .run();
  return id;
}

export async function updateAgraHighlight(db: D1Like, id: string, input: AgraHighlightInput): Promise<void> {
  await db
    .prepare(
      `UPDATE agra_highlights SET name = ?, description = ?, image = ?, sort_order = ?, updated_at = ? WHERE id = ?`
    )
    .bind(input.name, input.description, input.image, input.sortOrder, new Date().toISOString(), id)
    .run();
}

export async function deleteAgraHighlight(db: D1Like, id: string): Promise<void> {
  await db.prepare(`DELETE FROM agra_highlights WHERE id = ?`).bind(id).run();
}
