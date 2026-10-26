#!/bin/sh
# Bundles the test with esbuild (stubbing nothing, contacts.ts has no Vite-only imports) and runs it.
set -e
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
OUT=$(mktemp -d)
npx --prefix "$ROOT" esbuild "$ROOT/scripts/contacts-test/run.ts" --bundle --platform=node --format=esm --outfile="$OUT/run.mjs" --external:node:sqlite --log-level=error
ROOT="$ROOT" node --experimental-sqlite --no-warnings "$OUT/run.mjs"
npx --prefix "$ROOT" esbuild "$ROOT/scripts/contacts-test/meta.ts" --bundle --platform=node --format=esm --outfile="$OUT/meta.mjs" --external:node:sqlite --log-level=error
ROOT="$ROOT" node --experimental-sqlite --no-warnings "$OUT/meta.mjs"
npx --prefix "$ROOT" esbuild "$ROOT/scripts/contacts-test/email.ts" --bundle --platform=node --format=esm --outfile="$OUT/email.mjs" --external:node:sqlite --log-level=error
ROOT="$ROOT" node --experimental-sqlite --no-warnings "$OUT/email.mjs"
npx --prefix "$ROOT" esbuild "$ROOT/scripts/contacts-test/marketing.ts" --bundle --platform=node --format=esm --outfile="$OUT/marketing.mjs" --external:node:sqlite --log-level=error
ROOT="$ROOT" node --experimental-sqlite --no-warnings "$OUT/marketing.mjs"
npx --prefix "$ROOT" esbuild "$ROOT/scripts/contacts-test/campaigns.ts" --bundle --platform=node --format=esm --outfile="$OUT/campaigns.mjs" --external:node:sqlite --log-level=error --define:import.meta.glob=__glob "--banner:js=const __glob = () => ({});"
ROOT="$ROOT" node --experimental-sqlite --no-warnings "$OUT/campaigns.mjs"
npx --prefix "$ROOT" esbuild "$ROOT/scripts/contacts-test/events.ts" --bundle --platform=node --format=esm --outfile="$OUT/events.mjs" --external:node:sqlite --log-level=error --define:import.meta.glob=__glob "--banner:js=const __glob = () => ({});"
ROOT="$ROOT" node --experimental-sqlite --no-warnings "$OUT/events.mjs"
npx --prefix "$ROOT" esbuild "$ROOT/scripts/contacts-test/booking.ts" --bundle --platform=node --format=esm --outfile="$OUT/booking.mjs" --external:node:sqlite --log-level=error --define:import.meta.glob=__glob "--banner:js=const __glob = () => ({});"
ROOT="$ROOT" node --experimental-sqlite --no-warnings "$OUT/booking.mjs"
npx --prefix "$ROOT" esbuild "$ROOT/scripts/contacts-test/whatsapp-media.ts" --bundle --platform=node --format=esm --outfile="$OUT/whatsapp-media.mjs" --external:node:sqlite --log-level=error --define:import.meta.glob=__glob "--banner:js=const __glob = () => ({});"
ROOT="$ROOT" node --experimental-sqlite --no-warnings "$OUT/whatsapp-media.mjs"
npx --prefix "$ROOT" esbuild "$ROOT/scripts/contacts-test/offers-timer.ts" --bundle --platform=node --format=esm --outfile="$OUT/offers-timer.mjs" --external:node:sqlite --log-level=error --define:import.meta.glob=__glob "--banner:js=const __glob = () => ({});"
ROOT="$ROOT" node --experimental-sqlite --no-warnings "$OUT/offers-timer.mjs"
npx --prefix "$ROOT" esbuild "$ROOT/scripts/contacts-test/wa-source.ts" --bundle --platform=node --format=esm --outfile="$OUT/wa-source.mjs" --log-level=error
ROOT="$ROOT" node --no-warnings "$OUT/wa-source.mjs"
npx --prefix "$ROOT" esbuild "$ROOT/scripts/contacts-test/ga-session.ts" --bundle --platform=node --format=esm --outfile="$OUT/ga-session.mjs" --log-level=error
ROOT="$ROOT" node --no-warnings "$OUT/ga-session.mjs"
npx --prefix "$ROOT" esbuild "$ROOT/scripts/contacts-test/blocked-paths.ts" --bundle --platform=node --format=esm --outfile="$OUT/blocked-paths.mjs" --log-level=error
ROOT="$ROOT" node --no-warnings "$OUT/blocked-paths.mjs"
node --no-warnings "$ROOT/scripts/contacts-test/backup-tools.mjs"
npx --prefix "$ROOT" esbuild "$ROOT/scripts/contacts-test/audit.ts" --bundle --platform=node --format=esm --outfile="$OUT/audit.mjs" --external:node:sqlite --log-level=error
ROOT="$ROOT" node --experimental-sqlite --no-warnings "$OUT/audit.mjs"
npx --prefix "$ROOT" esbuild "$ROOT/scripts/contacts-test/staff.ts" --bundle --platform=node --format=esm --outfile="$OUT/staff.mjs" --external:node:sqlite --log-level=error
ROOT="$ROOT" node --experimental-sqlite --no-warnings "$OUT/staff.mjs"
npx --prefix "$ROOT" esbuild "$ROOT/scripts/contacts-test/route-inventory.ts" --bundle --platform=node --format=esm --outfile="$OUT/route-inventory.mjs" --log-level=error
ROOT="$ROOT" node --no-warnings "$OUT/route-inventory.mjs"
npx --prefix "$ROOT" esbuild "$ROOT/scripts/contacts-test/admin-password.ts" --bundle --platform=node --format=esm --outfile="$OUT/admin-password.mjs" --log-level=error
ROOT="$ROOT" node --no-warnings "$OUT/admin-password.mjs"
npx --prefix "$ROOT" esbuild "$ROOT/scripts/contacts-test/leads-owner.ts" --bundle --platform=node --format=esm --outfile="$OUT/leads-owner.mjs" --external:node:sqlite --log-level=error --define:import.meta.glob=__glob "--banner:js=const __glob = () => ({});"
ROOT="$ROOT" node --experimental-sqlite --no-warnings "$OUT/leads-owner.mjs"
