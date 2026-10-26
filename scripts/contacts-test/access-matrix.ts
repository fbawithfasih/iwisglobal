// Fails if a permission rule in src/lib/authz.ts is missing from docs/platform/IWIS_ACCESS_CONTROL_MATRIX.md.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OWNER_ONLY_ACTIONS, OWNER_ONLY_PAGES } from '../../src/lib/authz';

const doc = readFileSync(`${process.env.ROOT}/docs/platform/IWIS_ACCESS_CONTROL_MATRIX.md`, 'utf8');
for (const page of OWNER_ONLY_PAGES) assert.ok(doc.includes('`' + page + '`'), `owner-only page "${page}" is missing from the access matrix`);
for (const [area, action] of OWNER_ONLY_ACTIONS) {
  assert.ok(new RegExp('`' + area + '`\\s*\\|\\s*`' + action + '`').test(doc), `owner-only action ${area}/${action} is missing from the access matrix`);
}
console.log('access matrix doc ok');
