#!/usr/bin/env node
// Makes the two values for a new owner password: ADMIN_PASSWORD_SALT and ADMIN_PASSWORD_HASH (PBKDF2-SHA256, 100,000
// rounds, the same as src/lib/passwordHash.ts). Run it on YOUR computer: the password is typed here, hidden, and never
// leaves the machine. Only the salt and hash (which cannot be turned back into the password) are printed; set them as
// secrets in Cloudflare Pages (Settings, Variables and Secrets) and redeploy.
//
//   node scripts/admin-password.mjs
//
// Piped input (two lines: password, then the same again) is accepted for testing.
import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { createInterface } from 'node:readline';

const MIN_LENGTH = 12;

function readHidden(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    let text = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const onData = (ch) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n' || c === '\u0004') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off('data', onData);
          process.stdout.write('\n');
          return resolve(text);
        }
        if (c === '\u0003') process.exit(130); // Ctrl-C
        if (c === '\u007f' || c === '\b') text = text.slice(0, -1);
        else text += c;
      }
    };
    process.stdin.on('data', onData);
  });
}

async function readTwoLines() {
  const rl = createInterface({ input: process.stdin });
  const lines = [];
  for await (const line of rl) lines.push(line);
  return lines;
}

let first;
let second;
if (process.stdin.isTTY) {
  first = await readHidden('New owner password (not shown): ');
  second = await readHidden('Type it again: ');
} else {
  [first = '', second = ''] = await readTwoLines();
}
if (first !== second) {
  console.error('The two entries do not match. Nothing was created.');
  process.exit(1);
}
if (first.length < MIN_LENGTH) {
  console.error(`Use at least ${MIN_LENGTH} characters (a few unrelated words is fine). Nothing was created.`);
  process.exit(1);
}
const salt = randomBytes(16);
const hash = pbkdf2Sync(Buffer.from(first, 'utf8'), salt, 100_000, 32, 'sha256');
console.log('\nSet these two as secrets in Cloudflare Pages, then redeploy:\n');
console.log(`ADMIN_PASSWORD_SALT=${salt.toString('hex')}`);
console.log(`ADMIN_PASSWORD_HASH=${hash.toString('hex')}\n`);
console.log('The password itself is not stored anywhere. Keep it in your password manager.');
