// D1-backed blog, managed from /admin/blog (schema_blog_posts.sql). Mirrors
// tours.ts's id/slug/status pattern rather than agraHighlights.ts's simpler
// shape, since posts have a draft/published lifecycle the same way tours
// have published/draft. Replaces the git-based `blog` content collection
// this repo shipped first (infrastructure-only, no posts) — that approach
// required a code change + redeploy per post; this lets posts be written
// and published from a browser form instead.

import type { D1Like } from './db';
import { marked } from 'marked';

export type BlogCategory = 'news' | 'travel-tips' | 'seasonal';
export type BlogStatus = 'draft' | 'published';

export interface BlogPostRow {
  id: string;
  slug: string;
  title: string;
  description: string;
  body: string;
  category: string;
  author_name: string;
  image: string;
  image_thumb: string;
  status: string;
  created_at: string;
  updated_at: string;
  date_published: string | null;
}

export interface BlogPost {
  id: string;
  slug: string;
  title: string;
  description: string;
  body: string;
  category: BlogCategory;
  authorName: string;
  image: string | null;
  // 800px copy of the cover for the /blog list; null = none (use image).
  imageThumb: string | null;
  status: BlogStatus;
  createdAt: string;
  updatedAt: string;
  datePublished: string | null;
}

function parseRow(row: BlogPostRow): BlogPost {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    body: row.body,
    category: (row.category as BlogCategory) || 'news',
    authorName: row.author_name,
    image: row.image || null,
    imageThumb: row.image_thumb || null,
    status: row.status === 'published' ? 'published' : 'draft',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    datePublished: row.date_published,
  };
}

// Renders a post's markdown body to HTML at request time — the D1
// equivalent of what Astro's content-collection `.render()` does at build
// time for guides/attractions. `marked` is synchronous-by-default here
// (no custom async extensions registered), so this is safe to call
// directly without awaiting a Promise.
export function renderBlogBody(body: string): string {
  return marked.parse(body, { async: false }) as string;
}

export interface BlogFilters {
  status?: BlogStatus;
}

export async function listBlogPosts(db: D1Like, filters: BlogFilters = {}): Promise<BlogPost[]> {
  const where = filters.status ? 'WHERE status = ?' : '';
  const { results } = await db
    .prepare(`SELECT * FROM blog_posts ${where} ORDER BY COALESCE(date_published, created_at) DESC`)
    .bind(...(filters.status ? [filters.status] : []))
    .all<BlogPostRow>();
  return results.map(parseRow);
}

export async function getBlogPostById(db: D1Like, id: string): Promise<BlogPost | null> {
  const row = await db.prepare(`SELECT * FROM blog_posts WHERE id = ?`).bind(id).first<BlogPostRow>();
  return row ? parseRow(row) : null;
}

export async function getBlogPostBySlug(db: D1Like, slug: string): Promise<BlogPost | null> {
  const row = await db.prepare(`SELECT * FROM blog_posts WHERE slug = ?`).bind(slug).first<BlogPostRow>();
  return row ? parseRow(row) : null;
}

function slugifyId(title: string): string {
  return title
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/(^_|_$)/g, '');
}

function slugifyUrl(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

async function uniqueId(db: D1Like, title: string): Promise<string> {
  const base = slugifyId(title) || 'POST';
  let id = base;
  let suffix = 2;
  while (await getBlogPostById(db, id)) {
    id = `${base}_${suffix}`;
    suffix++;
  }
  return id;
}

async function uniqueSlug(db: D1Like, title: string): Promise<string> {
  const base = slugifyUrl(title) || 'post';
  let slug = base;
  let suffix = 2;
  while (await getBlogPostBySlug(db, slug)) {
    slug = `${base}-${suffix}`;
    suffix++;
  }
  return slug;
}

export interface BlogPostInput {
  title: string;
  description: string;
  body: string;
  category: BlogCategory;
  authorName: string;
  image: string;
  imageThumb: string;
  status: BlogStatus;
}

export async function createBlogPost(db: D1Like, input: BlogPostInput): Promise<string> {
  const id = await uniqueId(db, input.title);
  const slug = await uniqueSlug(db, input.title);
  const now = new Date().toISOString();
  const datePublished = input.status === 'published' ? now : null;
  await db
    .prepare(
      `INSERT INTO blog_posts (id, slug, title, description, body, category, author_name, image, image_thumb, status, created_at, updated_at, date_published)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, slug, input.title, input.description, input.body, input.category, input.authorName, input.image, input.imageThumb, input.status, now, now, datePublished)
    .run();
  return id;
}

// Preserves the slug and the original date_published (so republishing a
// post that was unpublished-then-republished doesn't look brand new) —
// date_published is only ever SET, never cleared or moved, the first time
// a post becomes 'published'.
export async function updateBlogPost(db: D1Like, id: string, input: BlogPostInput): Promise<void> {
  const existing = await getBlogPostById(db, id);
  const now = new Date().toISOString();
  const datePublished =
    input.status === 'published' ? existing?.datePublished ?? now : existing?.datePublished ?? null;
  await db
    .prepare(
      `UPDATE blog_posts
       SET title = ?, description = ?, body = ?, category = ?, author_name = ?, image = ?, image_thumb = ?, status = ?, updated_at = ?, date_published = ?
       WHERE id = ?`
    )
    .bind(input.title, input.description, input.body, input.category, input.authorName, input.image, input.imageThumb, input.status, now, datePublished, id)
    .run();
}

export async function deleteBlogPost(db: D1Like, id: string): Promise<void> {
  await db.prepare(`DELETE FROM blog_posts WHERE id = ?`).bind(id).run();
}
