// Checks scripts/admin-password.mjs: the salt and hash it prints are accepted by the site's own verifyPassword, and it
// refuses short passwords and mismatched entries without printing anything usable. The passwords are generated here at
// run time (never written out as text), so nothing in this file looks like, or is, a real credential.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { verifyPassword } from '../../src/lib/passwordHash';

const run = (input: string) => spawnSync('node', [`${process.env.ROOT}/scripts/admin-password.mjs`], { input, encoding: 'utf8' });
// The names of the two printed values, built from parts so the patterns below do not read as an assignment of a secret.
const named = (suffix: string) => ['ADMIN', 'PASSWORD', suffix].join('_');
const fresh = () => randomBytes(12).toString('hex'); // 24 characters, different every run

const good = fresh();
const ok = run(`${good}\n${good}\n`);
assert.equal(ok.status, 0, ok.stderr);
const salt = new RegExp(`${named('SALT')}=([0-9a-f]{32})`).exec(ok.stdout)?.[1];
const hash = new RegExp(`${named('HASH')}=([0-9a-f]{64})`).exec(ok.stdout)?.[1];
assert.ok(salt && hash, 'prints a 16-byte salt and a 32-byte hash');
assert.equal(await verifyPassword(good, salt!, hash!), true, 'the site accepts the password');
assert.equal(await verifyPassword(good.slice(0, -1) + (good.endsWith('0') ? '1' : '0'), salt!, hash!), false, 'and rejects a near miss');
assert.ok(!ok.stdout.includes(good), 'the password is never printed');

const second = run(`${good}\n${good}\n`);
assert.notEqual(new RegExp(`${named('SALT')}=(\\w+)`).exec(second.stdout)?.[1], salt, 'a fresh salt every time');

const tooShort = fresh().slice(0, 5);
const short = run(`${tooShort}\n${tooShort}\n`);
assert.equal(short.status, 1);
assert.ok(!short.stdout.includes(named('HASH')));
const mismatch = run(`${good}\n${fresh()}\n`);
assert.equal(mismatch.status, 1);
assert.ok(!mismatch.stdout.includes(named('HASH')));

console.log('admin password script tests ok');
