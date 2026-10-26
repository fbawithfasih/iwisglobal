// Checks the GA4 ids carried in a tour order's gaClientId note (packGa / unpackGa in src/lib/payments/orderNotes.ts).
import assert from 'node:assert/strict';
import { packGa, unpackGa } from '../../src/lib/payments/orderNotes';

assert.equal(packGa('123456789.1729900000', '1729911111'), '123456789.1729900000|1729911111');
assert.equal(packGa('123456789.1729900000', undefined), '123456789.1729900000', 'no session id: client id alone, as before');
assert.equal(packGa('123456789.1729900000', 's1729$o2'), '123456789.1729900000', 'a malformed session id is dropped');
assert.equal(packGa(undefined, '1729911111'), undefined, 'no client id: no note');
assert.equal(packGa('GA1.1.123.456', '1'), undefined, 'only the bare client id is accepted');
assert.deepEqual(unpackGa('123456789.1729900000|1729911111'), { clientId: '123456789.1729900000', sessionId: '1729911111' });
// Orders created before this change carry the client id alone.
assert.deepEqual(unpackGa('123456789.1729900000'), { clientId: '123456789.1729900000', sessionId: '' });
assert.deepEqual(unpackGa(undefined), { clientId: '', sessionId: '' });
assert.deepEqual(unpackGa('x|y'), { clientId: '', sessionId: '' });
// Every value packGa makes fits a Razorpay note (256 characters).
assert.ok(packGa(`${'9'.repeat(20)}.${'9'.repeat(20)}`, '9'.repeat(20))!.length < 256);

console.log('ga session tests ok');
