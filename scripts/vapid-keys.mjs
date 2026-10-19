#!/usr/bin/env node
// Makes a VAPID key pair for the admin phone alerts (src/lib/webPush.ts).
// Prints two lines to paste into Cloudflare Pages as secrets named
// VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY. Run it on your own computer and do not
// paste the output into chat, a file in the repository, or a commit.
import { generateKeyPairSync } from 'node:crypto';

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = privateKey.export({ format: 'jwk' });
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
console.log(`VAPID_PUBLIC_KEY=${b64u(pub)}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
