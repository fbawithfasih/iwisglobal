// Checks the cross-site form rule in src/lib/originCheck.ts: it must refuse everything Astro's built-in check refuses,
// except exactly one thing, a mail provider's one-click unsubscribe.
import assert from 'node:assert/strict';
import { isForbiddenCrossSitePost, isOneClickUnsubscribe, ONE_CLICK_BODY } from '../../src/lib/originCheck';

const SITE = 'https://www.iwisglobal.com';
const FORM = 'application/x-www-form-urlencoded';
const req = (path: string, init: { method?: string; type?: string; origin?: string | null; body?: string } = {}) => {
  const headers: Record<string, string> = {};
  if (init.type) headers['content-type'] = init.type;
  if (init.origin) headers['origin'] = init.origin;
  const body = init.body ?? '';
  if (body) headers['content-length'] = String(new TextEncoder().encode(body).length);
  const url = new URL(path, SITE);
  return { request: new Request(url, { method: init.method ?? 'POST', headers, body: init.method === 'GET' ? undefined : body || undefined }), url };
};
const forbidden = async (path: string, init?: Parameters<typeof req>[1]) => {
  const { request, url } = req(path, init);
  return isForbiddenCrossSitePost(request, url);
};

// ---- the same rule as Astro's
assert.equal(await forbidden('/contact', { type: FORM, origin: SITE, body: 'a=1' }), false, 'same-origin form post is fine');
assert.equal(await forbidden('/contact', { type: FORM, body: 'a=1' }), true, 'a form post with no Origin is refused');
assert.equal(await forbidden('/contact', { type: FORM, origin: 'https://evil.example', body: 'a=1' }), true, 'cross-origin form post is refused');
assert.equal(await forbidden('/contact', { type: FORM, origin: 'null', body: 'a=1' }), true, 'Origin: null is refused');
assert.equal(await forbidden('/contact', { type: 'multipart/form-data; boundary=x', body: 'x' }), true, 'multipart without Origin is refused');
assert.equal(await forbidden('/contact', { type: 'text/plain', body: 'x' }), true, 'text/plain without Origin is refused');
assert.equal(await forbidden('/api/leads', { type: 'application/json', body: '{}' }), false, 'JSON is not a form post and is not covered (webhooks, API calls)');
assert.equal(await forbidden('/contact', { method: 'GET' }), false, 'GET is never refused');
assert.equal(await forbidden('/contact', { method: 'PUT', type: FORM, body: 'a=1' }), true, 'PUT with a form type and no Origin is refused');
assert.equal(await forbidden('/contact', { method: 'DELETE', type: FORM, body: 'a=1' }), true);

// ---- the one exemption: exactly what Gmail, Yahoo and Apple Mail send
const token = 'per_abc123.0123456789abcdef0123456789abcdef';
assert.equal(await forbidden(`/unsubscribe/${token}`, { type: FORM, body: ONE_CLICK_BODY }), false, 'one-click unsubscribe with no Origin is allowed');
assert.equal(await forbidden(`/unsubscribe/${token}`, { type: `${FORM}; charset=UTF-8`, body: ONE_CLICK_BODY }), false, 'a charset parameter is fine');
assert.equal(await forbidden(`/de/unsubscribe/${token}`, { type: FORM, body: ONE_CLICK_BODY }), false, 'localised path is fine');
assert.equal(await forbidden(`/unsubscribe/${token}`, { type: FORM, body: `${ONE_CLICK_BODY}\r\n` }), false, 'trailing newline is fine');

// ---- and nothing wider
assert.equal(await forbidden(`/unsubscribe/${token}`, { type: FORM, body: 'List-Unsubscribe=Other' }), true, 'a different body is refused');
assert.equal(await forbidden(`/unsubscribe/${token}`, { type: FORM, body: `${ONE_CLICK_BODY}&extra=1` }), true, 'extra fields are refused');
assert.equal(await forbidden(`/unsubscribe/${token}`, { type: 'text/plain', body: ONE_CLICK_BODY }), true, 'wrong content type is refused');
assert.equal(await forbidden(`/unsubscribe/${token}`, { type: 'multipart/form-data; boundary=x', body: ONE_CLICK_BODY }), true);
assert.equal(await forbidden(`/unsubscribe/${token}`, { type: FORM, body: 'x'.repeat(500) }), true, 'a large body is refused');
assert.equal(await forbidden('/subscribe', { type: FORM, body: ONE_CLICK_BODY }), true, 'the same body on another path is refused');
assert.equal(await forbidden('/admin/leads', { type: FORM, body: ONE_CLICK_BODY }), true, 'never on admin pages');
assert.equal(await forbidden('/api/subscribe', { type: FORM, body: ONE_CLICK_BODY }), true);
assert.equal(await forbidden('/unsubscribe/', { type: FORM, body: ONE_CLICK_BODY }), true, 'no token, no exemption');
assert.equal(await forbidden(`/unsubscribe/${token}/extra`, { type: FORM, body: ONE_CLICK_BODY }), true, 'extra path segments are refused');
assert.equal(await forbidden(`/unsubscribe/${token}`, { method: 'PUT', type: FORM, body: ONE_CLICK_BODY }), true, 'only POST');

// The page's own button (same-origin, with its own body) keeps working.
assert.equal(await forbidden(`/unsubscribe/${token}`, { type: FORM, origin: SITE, body: '' }), false);

// The exemption helper does not consume the body the page will read.
{
  const { request, url } = req(`/unsubscribe/${token}`, { type: FORM, body: ONE_CLICK_BODY });
  assert.equal(await isOneClickUnsubscribe(request, url), true);
  assert.equal(await request.text(), ONE_CLICK_BODY, 'the original request body is still readable');
}
console.log('origin check tests ok');
