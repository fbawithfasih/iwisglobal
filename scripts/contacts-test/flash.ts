// The one-time "Saved" message: only fixed messages can ever be shown, it is shown once, and a bad or old cookie shows nothing.
import assert from 'node:assert/strict';
import { setFlash, takeFlash, FLASH_COOKIE, FLASH_MESSAGES } from '../../src/lib/flash';

// A tiny stand-in for Astro's cookies.
const jar = () => {
  const store = new Map<string, { value: string; opts?: any }>();
  return {
    store,
    set: (k: string, v: string, o?: any) => void store.set(k, { value: v, opts: o }),
    get: (k: string) => (store.has(k) ? { value: store.get(k)!.value } : undefined),
    delete: (k: string) => void store.delete(k),
  } as any;
};

let c = jar();
assert.equal(takeFlash(c), null, 'nothing to show by default');

setFlash(c, 'itinerary');
assert.equal(c.store.get(FLASH_COOKIE).value, 'itinerary', 'the cookie holds a key, not text');
assert.deepEqual([c.store.get(FLASH_COOKIE).opts.path, c.store.get(FLASH_COOKIE).opts.httpOnly, c.store.get(FLASH_COOKIE).opts.secure], ['/admin', true, true]);
assert.ok(c.store.get(FLASH_COOKIE).opts.maxAge <= 120, 'short lived');
assert.equal(takeFlash(c), 'Itinerary saved');
assert.equal(takeFlash(c), null, 'shown once: a refresh shows nothing');

// Every key maps to a short plain message.
for (const [k, v] of Object.entries(FLASH_MESSAGES)) {
  c = jar(); setFlash(c, k as any);
  assert.equal(takeFlash(c), v);
  assert.ok(v.length > 0 && v.length < 40 && !/[<>&"]/.test(v), `message for ${k} is short and plain`);
}

// A forged or stale cookie shows nothing and is still cleared (no way to put your own words on the screen).
for (const bad of ['<script>alert(1)</script>', 'toString', '__proto__', 'constructor', '', 'Saved ']) {
  c = jar(); c.set(FLASH_COOKIE, bad);
  assert.equal(takeFlash(c), null, `forged value ${JSON.stringify(bad)} shows nothing`);
  assert.equal(c.get(FLASH_COOKIE), undefined, 'and the cookie is cleared');
}
console.log('flash tests ok');
