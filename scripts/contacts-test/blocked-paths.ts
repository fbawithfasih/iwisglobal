// Checks the path guard for framework endpoints the site does not use (src/lib/blockedPaths.ts).
import assert from 'node:assert/strict';
import { isBlockedPath, normalisePath } from '../../src/lib/blockedPaths';

// Every spelling that reached the endpoint on a local build, plus the ones the router rejected anyway.
const blocked = [
  '/_image',
  '/_image/',
  '/_IMAGE',
  '/_Image/anything/else',
  '/%5Fimage',
  '/%5fimage',
  '/%255Fimage',
  '/%25255Fimage',
  '//_image',
  '///_image',
  '/./_image',
  '/foo/../_image',
  '/foo/%2e%2e/_image',
  '/%2e/_image',
  '/\\_image',
  '/_im%61ge',
];
for (const p of blocked) assert.equal(isBlockedPath(p), true, `${p} must be blocked`);

// Real pages and files must never be caught, including names that merely contain the word.
const allowed = [
  '/',
  '/tours',
  '/tours/same-day-agra-from-delhi',
  '/images/tours/591c8a76-9187-4656-9dd2-34f2d64343a6.webp',
  '/blog-images/taj-mahal-myths-vs-facts.jpg',
  '/admin',
  '/admin/leads',
  '/api/leads',
  '/hero-taj-mahal.jpg',
  '/foo/_image',
  '/image',
  '/_images',
  '/my_image',
  '/es/blog/gatimaan-express-delhi-to-agra-timetable-fares-booking',
];
for (const p of allowed) assert.equal(isBlockedPath(p), false, `${p} must not be blocked`);

// A malformed escape must neither throw nor hide the segment.
assert.equal(isBlockedPath('/%E0%A4%A'), false);
assert.equal(isBlockedPath('/%zz/_image'), false, '"/%zz/" is its own first segment, so nothing is blocked');
// A stray trailing % makes it a different path ("_image%"), which no route serves.
assert.equal(isBlockedPath('/%5Fimage%'), false);

assert.deepEqual(normalisePath('/A//b/./c/../D/'), ['a', 'b', 'd']);

console.log('blocked path tests ok');
