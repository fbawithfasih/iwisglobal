// Checks the pictures on the admin Blog list (src/lib/blogAdmin.ts).
import assert from 'node:assert/strict';
import { wordCount, readMinutes, daysSince, updatedLabel, postHealth, monthlyCounts, blogSummary, barWidth, STALE_DAYS } from '../../src/lib/blogAdmin';

assert.equal(wordCount('Hello brave new world'), 4);
assert.equal(wordCount('See [our tour](/tours/sunrise) now'), 4, 'the link target is not words');
assert.equal(wordCount('## Heading\n\n**bold** and _italic_ text'), 5);
assert.equal(wordCount('<p>one <b>two</b></p>'), 2);
assert.equal(wordCount('Zeit für den Taj Mahal: schön!'), 6, 'accented words count');
assert.equal(wordCount(''), 0);
assert.equal(readMinutes(0), 1); assert.equal(readMinutes(200), 1); assert.equal(readMinutes(201), 2); assert.equal(readMinutes(1000), 5);

const NOW = Date.parse('2026-10-28T12:00:00Z');
assert.equal(daysSince('2026-10-28T01:00:00Z', NOW), 0);
assert.equal(daysSince('2026-10-18T12:00:00Z', NOW), 10);
assert.equal(daysSince('2027-01-01', NOW), 0); assert.equal(daysSince(null, NOW), 0); assert.equal(daysSince('nope', NOW), 0);
assert.deepEqual([updatedLabel(0), updatedLabel(1), updatedLabel(12), updatedLabel(59), updatedLabel(150)], ['Updated today', 'Updated yesterday', 'Updated 12 days ago', 'Updated 59 days ago', 'Updated 5 months ago']);

const good: { title: string; description: string; body: string; image: string | null } = { title: 'Diwali and the Taj Mahal: Festivals and Crowds', description: 'Visiting the Taj Mahal around Diwali 2026: dates, whether it is open, crowd and smog patterns, and how to plan.', body: 'Read about [our sunrise tour](/tours/taj-mahal-sunrise-tour) today.', image: '/blog-images/a.jpg' };
assert.deepEqual(postHealth(good), { done: 4, total: 4, missing: [] });
assert.deepEqual(postHealth({ ...good, image: null }).missing, ['Cover photo']);
assert.deepEqual(postHealth({ ...good, title: 'x'.repeat(61) }).missing, ['Title up to 60 characters']);
assert.deepEqual(postHealth({ ...good, title: '' }).missing, ['Title up to 60 characters']);
assert.deepEqual(postHealth({ ...good, description: 'Too short.' }).missing, ['Description 70 to 160 characters']);
assert.deepEqual(postHealth({ ...good, description: 'y'.repeat(161) }).missing, ['Description 70 to 160 characters']);
assert.deepEqual(postHealth({ ...good, body: 'No links here at all. See /tourism guide.' }).missing, ['Link to a tour'], '/tourism is not a tour link');
assert.equal(postHealth({ ...good, body: 'Browse all [tours](/tours)' }).missing.length, 0, 'the tours page counts');
assert.equal(postHealth({ title: '', description: '', body: '', image: null }).done, 0);

const P = (status: string, datePublished: string | null) => ({ status: status as 'published' | 'draft', datePublished });
const months = monthlyCounts([P('published', '2026-10-17T00:00:00Z'), P('published', '2026-10-02T00:00:00Z'), P('published', '2026-08-30T00:00:00Z'), P('draft', '2026-10-05T00:00:00Z'), P('published', '2026-03-01T00:00:00Z'), P('published', null), P('published', 'bad')], NOW, 6);
assert.deepEqual(months.map((m) => [m.key, m.n]), [['2026-05', 0], ['2026-06', 0], ['2026-07', 0], ['2026-08', 1], ['2026-09', 0], ['2026-10', 2]], 'drafts, undated and too-old posts are left out; empty months stay');
assert.equal(months[5].label, 'Oct 26');
assert.equal(monthlyCounts([], Date.parse('2026-02-10T00:00:00Z'), 3).map((m) => m.key).join(), '2025-12,2026-01,2026-02', 'across a year end');

const S = (status: string, updatedAt: string, o: Partial<typeof good> = {}) => ({ ...good, ...o, status: status as 'published' | 'draft', updatedAt });
const sum = blogSummary([S('published', '2026-10-20'), S('published', '2026-01-01'), S('published', '2026-10-01', { image: null }), S('draft', '2025-01-01'), S('draft', '2026-10-27')], NOW);
assert.deepEqual(sum, { total: 5, published: 3, drafts: 2, stale: 1, toFinish: 1 }, 'a stale or unfinished draft is not counted: it is not live');
assert.equal(STALE_DAYS, 180);
assert.deepEqual(blogSummary([], NOW), { total: 0, published: 0, drafts: 0, stale: 0, toFinish: 0 });
assert.equal(barWidth(0, 3), 0); assert.equal(barWidth(1, 100), 4); assert.equal(barWidth(3, 3), 100);
console.log('blog admin tests ok');
