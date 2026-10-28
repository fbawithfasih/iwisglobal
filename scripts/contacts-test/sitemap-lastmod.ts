// Checks the sitemap date helpers (src/lib/sitemapLastmod.mjs): only real, valid, non-future dates are ever emitted.
import assert from 'node:assert/strict';
import { toLastmod, frontmatterDate, newest, pathWithoutLocale, lastmodFor } from '../../src/lib/sitemapLastmod.mjs';

const NOW = Date.parse('2026-10-28T12:00:00Z');
assert.equal(toLastmod('2026-10-26T09:30:00.000Z', NOW), '2026-10-26T09:30:00.000Z');
assert.equal(toLastmod('2026-10-26', NOW), '2026-10-26T00:00:00.000Z');
assert.equal(toLastmod('', NOW), undefined);
assert.equal(toLastmod('not a date', NOW), undefined);
assert.equal(toLastmod(undefined as unknown as string, NOW), undefined);
assert.equal(toLastmod('2027-03-01', NOW), undefined, 'a date well in the future is never published');
assert.equal(toLastmod('2026-10-29', NOW), '2026-10-29T00:00:00.000Z', 'a day ahead is allowed for time zones');

const md = '---\ntitle: "X"\ndatePublished: 2026-09-21\ndateModified: 2026-09-27\n---\n\nBody dateModified: 2000-01-01';
assert.equal(frontmatterDate(md), '2026-09-27');
assert.equal(frontmatterDate(md, 'datePublished'), '2026-09-21');
assert.equal(frontmatterDate('---\ndateModified: "2026-10-01"\n---\n'), '2026-10-01', 'quotes are stripped');
assert.equal(frontmatterDate('---\ntitle: x\n---\n'), undefined);
assert.equal(frontmatterDate('no front matter'), undefined);
assert.equal(frontmatterDate('---\ndateModified: soon\n---\n'), undefined, 'a non-date is ignored');

assert.equal(newest(['2026-10-01', '2026-10-20T00:00:00Z', undefined as unknown as string]), '2026-10-20T00:00:00.000Z');
assert.equal(newest([]), undefined);

assert.equal(pathWithoutLocale('https://www.iwisglobal.com/'), '/');
assert.equal(pathWithoutLocale('https://www.iwisglobal.com/de'), '/');
assert.equal(pathWithoutLocale('https://www.iwisglobal.com/de/blog/a-post'), '/blog/a-post');
assert.equal(pathWithoutLocale('https://www.iwisglobal.com/blog/a-post/'), '/blog/a-post');
assert.equal(pathWithoutLocale('https://www.iwisglobal.com/delhi'), '/delhi', 'a path that merely starts with "de" is not a locale');

const dates = new Map([['/blog/a-post', '2026-10-26T00:00:00.000Z'], ['/blog', '2026-10-26T00:00:00.000Z']]);
assert.equal(lastmodFor('https://www.iwisglobal.com/fr/blog/a-post', dates), '2026-10-26T00:00:00.000Z');
assert.equal(lastmodFor('https://www.iwisglobal.com/blog', dates), '2026-10-26T00:00:00.000Z');
assert.equal(lastmodFor('https://www.iwisglobal.com/about', dates), undefined, 'no real date, no lastmod');
console.log('sitemap lastmod tests ok');
