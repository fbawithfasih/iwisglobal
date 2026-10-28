// The pictures on the admin Blog list (src/pages/admin/blog/index.astro): what is live and what is a draft, which published posts have not
// been touched for a long time, which still miss something a reader or Google looks for, and how often posts go out. Pure functions over
// the posts the page already loads. Search ranking is not in the database, so nothing here claims to know how a post performs.

import type { BlogPost } from './blog';

export const STALE_DAYS = 180;
const DAY_MS = 86_400_000;

/** Words in a markdown body: link targets, tags and symbols are not counted. */
export function wordCount(body: string): number {
  const text = String(body ?? '').replace(/\]\([^)]*\)/g, ']').replace(/<[^>]*>/g, ' ').replace(/[`*_#>|~[\]]/g, ' ');
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
}

/** Minutes to read at 200 words a minute, at least 1. */
export const readMinutes = (words: number): number => Math.max(1, Math.ceil(words / 200));

/** Whole days since an ISO date; 0 for a bad or future date. */
export function daysSince(iso: string | null | undefined, nowMs: number): number {
  const ms = Date.parse(iso ?? '');
  return Number.isFinite(ms) ? Math.max(0, Math.floor((nowMs - ms) / DAY_MS)) : 0;
}

/** "Updated today", "Updated yesterday", "Updated 12 days ago", "Updated 5 months ago". */
export function updatedLabel(days: number): string {
  if (days <= 0) return 'Updated today';
  if (days === 1) return 'Updated yesterday';
  if (days < 60) return `Updated ${days} days ago`;
  return `Updated ${Math.round(days / 30)} months ago`;
}

export interface PostHealth { done: number; total: number; missing: string[] }

/** The four things checked on a post: a cover photo, a title that fits in a Google result, a description of a useful length, and a link on to a tour. */
export function postHealth(p: Pick<BlogPost, 'title' | 'description' | 'body' | 'image'>): PostHealth {
  const title = p.title.trim().length;
  const description = p.description.trim().length;
  const checks: Array<[string, boolean]> = [
    ['Cover photo', !!p.image],
    ['Title up to 60 characters', title > 0 && title <= 60],
    ['Description 70 to 160 characters', description >= 70 && description <= 160],
    ['Link to a tour', /\/tours(\/|\)|\s|$)/.test(p.body)],
  ];
  return { done: checks.filter(([, ok]) => ok).length, total: checks.length, missing: checks.filter(([, ok]) => !ok).map(([n]) => n) };
}

export interface MonthCount { key: string; label: string; n: number }

/** Published posts per calendar month (UTC) for the last `months` months, oldest first, including empty months. */
export function monthlyCounts(posts: Pick<BlogPost, 'status' | 'datePublished'>[], nowMs: number, months = 6): MonthCount[] {
  const now = new Date(nowMs);
  const out: MonthCount[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    out.push({ key, label: d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }), n: 0 });
  }
  for (const p of posts) {
    if (p.status !== 'published' || !p.datePublished) continue;
    const ms = Date.parse(p.datePublished);
    if (!Number.isFinite(ms)) continue;
    const d = new Date(ms);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const slot = out.find((m) => m.key === key);
    if (slot) slot.n += 1;
  }
  return out;
}

export interface BlogSummary { total: number; published: number; drafts: number; stale: number; toFinish: number }

/** Counts for the tiles. "Stale": published and not updated for 180 days. "To finish": published but missing one of the four checks. */
export function blogSummary(posts: Pick<BlogPost, 'status' | 'updatedAt' | 'title' | 'description' | 'body' | 'image'>[], nowMs: number): BlogSummary {
  const s: BlogSummary = { total: posts.length, published: 0, drafts: 0, stale: 0, toFinish: 0 };
  for (const p of posts) {
    if (p.status !== 'published') { s.drafts += 1; continue; }
    s.published += 1;
    if (daysSince(p.updatedAt, nowMs) >= STALE_DAYS) s.stale += 1;
    if (postHealth(p).missing.length > 0) s.toFinish += 1;
  }
  return s;
}

/** Bar width in percent: 0 for none, at least 4 so one is visible, 100 for the largest. */
export function barWidth(n: number, max: number): number {
  return n <= 0 || max <= 0 ? 0 : Math.max(4, Math.min(100, Math.round((n / max) * 100)));
}
