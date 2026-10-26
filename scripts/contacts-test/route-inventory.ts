// Route inventory: every file under src/pages/admin must check the caller itself (second layer behind the middleware gate),
// and must pass `locals` so staff sessions identified by the gate are honoured. The only files allowed to skip the check are
// the sign-in and sign-out pages and Google's hand-off, which are open by design (see OPEN_SECTIONS in src/lib/adminGate.ts).
// A new admin page that forgets the check fails here, so "deny by default" does not depend on anyone remembering.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = `${process.env.ROOT}/src/pages/admin`;
const OPEN = new Set(['login.astro', 'logout.astro', 'auth/google/start.ts', 'auth/google/callback.ts']);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(root).filter((f) => /\.(astro|ts)$/.test(f)).map((f) => relative(root, f).replace(/\\/g, '/'));
assert.ok(files.length > 40, `found ${files.length} admin route files`);

const unchecked: string[] = [];
const noLocals: string[] = [];
for (const f of files) {
  if (OPEN.has(f)) continue;
  const text = readFileSync(join(root, f), 'utf8');
  const m = /isAdminAuthenticated\(([^)]*)\)/.exec(text);
  if (!m) unchecked.push(f);
  else if (!/locals/.test(m[1])) noLocals.push(f);
}
assert.deepEqual(unchecked, [], `admin routes without their own sign-in check: ${unchecked.join(', ')}`);
assert.deepEqual(noLocals, [], `admin routes that do not pass locals (staff sessions would be refused): ${noLocals.join(', ')}`);

// The open routes really are the ones named, and none of them changes data for an unauthenticated caller.
for (const f of OPEN) assert.ok(files.includes(f), `open route ${f} exists`);
const login = readFileSync(join(root, 'login.astro'), 'utf8');
assert.ok(login.includes('verifyPassword'), 'login verifies the password before issuing a session');
const callback = readFileSync(join(root, 'auth/google/callback.ts'), 'utf8');
assert.ok(callback.includes('completeStaffSignIn') && callback.includes('state !== expected'), 'Google callback checks state and the invite');

console.log(`route inventory ok (${files.length} files, ${OPEN.size} open by design)`);
