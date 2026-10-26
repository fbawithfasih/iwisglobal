// Checks the ad source carried into WhatsApp chats started from the site (src/lib/waSourceTag.ts).
import assert from 'node:assert/strict';
import { sourceTag, withSourceTag, parseWaRef } from '../../src/lib/waSourceTag';

const link = 'https://wa.me/916399226633?text=Hi!%20I%20have%20a%20question.%20(ref%3A%20BOOKBAR-TOURS-SAME-DAY-AGRA-FROM-DELHI)';
const text = (href: string) => new URL(href).searchParams.get('text');

// The tag from the visitor's first touch
assert.equal(sourceTag({ source: 'google', medium: 'paid', campaign: '23145678901' }), 'google/paid/23145678901');
assert.equal(sourceTag({ source: 'fb', medium: 'paid', campaign: 'Sales – Same-Day Agra from Delhi' }), 'fb/paid/sales-same-day-agra-from-delhi');
assert.equal(sourceTag({ gclid: 'Cj0KCQ' }), 'google/paid', 'a Google click id alone still says google');
assert.equal(sourceTag({ fbclid: 'IwAR' }), 'meta/paid');
assert.equal(sourceTag({ source: 'chatgpt', medium: 'paid', campaign: '42' }), 'chatgpt/paid/42');
assert.equal(sourceTag({}), '', 'no ad, no tag');
assert.equal(sourceTag(null), '');

// Added inside the ref bracket, once
const tagged = withSourceTag(link, 'google/paid/23145678901');
assert.equal(text(tagged), 'Hi! I have a question. (ref: BOOKBAR-TOURS-SAME-DAY-AGRA-FROM-DELHI · via google/paid/23145678901)');
assert.equal(withSourceTag(tagged, 'meta/paid'), tagged, 'never tagged twice');
assert.equal(withSourceTag(link, ''), link, 'unchanged without a tag');
assert.equal(withSourceTag('https://wa.me/916399226633?text=Hello', 'google/paid'), 'https://wa.me/916399226633?text=Hello', 'unchanged without a ref');
assert.equal(withSourceTag('https://example.com/?text=(ref: X)', 'google/paid'), 'https://example.com/?text=(ref: X)', 'only wa.me links');

// Read back by the webhook
assert.deepEqual(parseWaRef(text(tagged)!), { ref: 'BOOKBAR-TOURS-SAME-DAY-AGRA-FROM-DELHI', source: 'google', medium: 'paid', campaign: '23145678901' });
assert.deepEqual(parseWaRef('Hi! (ref: FLOATING-HOME)'), { ref: 'FLOATING-HOME', source: '', medium: '', campaign: '' }, 'untagged as before');
assert.deepEqual(parseWaRef('just a question'), { ref: '', source: '', medium: '', campaign: '' });

console.log('whatsapp source tag tests ok');
