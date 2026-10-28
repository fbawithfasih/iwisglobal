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
npx --prefix "$ROOT" esbuild "$ROOT/scripts/contacts-test/wa-handler.ts" --bundle --platform=node --format=esm --outfile="$OUT/wa-handler.mjs" --external:node:sqlite --log-level=error --define:import.meta.glob=__glob "--banner:js=const __glob = () => ({});"
ROOT="$ROOT" node --experimental-sqlite --no-warnings "$OUT/wa-handler.mjs"
npx --prefix "$ROOT" esbuild "$ROOT/scripts/contacts-test/bookings-admin.ts" --bundle --platform=node --format=esm --outfile="$OUT/bookings-admin.mjs" --external:node:sqlite --log-level=error --define:import.meta.glob=__glob "--banner:js=const __glob = () => ({});"
ROOT="$ROOT" node --experimental-sqlite --no-warnings "$OUT/bookings-admin.mjs"
npx --prefix "$ROOT" esbuild "$ROOT/scripts/contacts-test/booking-notes.ts" --bundle --platform=node --format=esm --outfile="$OUT/booking-notes.mjs" --external:node:sqlite --log-level=error --define:import.meta.glob=__glob "--banner:js=const __glob = () => ({});"
ROOT="$ROOT" node --experimental-sqlite --no-warnings "$OUT/booking-notes.mjs"
npx --prefix "$ROOT" esbuild "$ROOT/scripts/contacts-test/booking-driver.ts" --bundle --platform=node --format=esm --outfile="$OUT/booking-driver.mjs" --external:node:sqlite --log-level=error --define:import.meta.glob=__glob "--banner:js=const __glob = () => ({});"
ROOT="$ROOT" node --experimental-sqlite --no-warnings "$OUT/booking-driver.mjs"
npx --prefix "$ROOT" esbuild "$ROOT/scripts/contacts-test/pickup.ts" --bundle --platform=node --format=esm --outfile="$OUT/pickup.mjs" --external:node:sqlite --log-level=error --define:import.meta.glob=__glob "--banner:js=const __glob = () => ({});"
ROOT="$ROOT" node --experimental-sqlite --no-warnings "$OUT/pickup.mjs"
npx --prefix "$ROOT" esbuild "$ROOT/scripts/contacts-test/leads-insights.ts" --bundle --platform=node --format=esm --outfile="$OUT/leads-insights.mjs" --external:node:sqlite --log-level=error --define:import.meta.glob=__glob "--banner:js=const __glob = () => ({});"
ROOT="$ROOT" node --experimental-sqlite --no-warnings "$OUT/leads-insights.mjs"
npx --prefix "$ROOT" esbuild "$ROOT/scripts/contacts-test/today-trends.ts" --bundle --platform=node --format=esm --outfile="$OUT/today-trends.mjs" --external:node:sqlite --log-level=error --define:import.meta.glob=__glob "--banner:js=const __glob = () => ({});"
ROOT="$ROOT" node --experimental-sqlite --no-warnings "$OUT/today-trends.mjs"
npx --prefix "$ROOT" esbuild "$ROOT/scripts/contacts-test/wa-direct.ts" --bundle --platform=node --format=esm --outfile="$OUT/wa-direct.mjs" --external:node:sqlite --log-level=error --define:import.meta.glob=__glob "--banner:js=const __glob = () => ({});"
ROOT="$ROOT" node --experimental-sqlite --no-warnings "$OUT/wa-direct.mjs"
npx --prefix "$ROOT" esbuild "$ROOT/scripts/contacts-test/booked-client.ts" --bundle --platform=node --format=esm --outfile="$OUT/booked-client.mjs" --external:node:sqlite --log-level=error --define:import.meta.glob=__glob "--banner:js=const __glob = () => ({});"
ROOT="$ROOT" node --experimental-sqlite --no-warnings "$OUT/booked-client.mjs"
npx --prefix "$ROOT" esbuild "$ROOT/scripts/contacts-test/wa-reactions.ts" --bundle --platform=node --format=esm --outfile="$OUT/wa-reactions.mjs" --external:node:sqlite --log-level=error --define:import.meta.glob=__glob "--banner:js=const __glob = () => ({});"
ROOT="$ROOT" node --experimental-sqlite --no-warnings "$OUT/wa-reactions.mjs"
npx --prefix "$ROOT" esbuild "$ROOT/scripts/contacts-test/flash.ts" --bundle --platform=node --format=esm --outfile="$OUT/flash.mjs" --external:node:sqlite --log-level=error --define:import.meta.glob=__glob "--banner:js=const __glob = () => ({});"
ROOT="$ROOT" node --experimental-sqlite --no-warnings "$OUT/flash.mjs"
npx --prefix "$ROOT" esbuild "$ROOT/scripts/contacts-test/today.ts" --bundle --platform=node --format=esm --outfile="$OUT/today.mjs" --external:node:sqlite --log-level=error --define:import.meta.glob=__glob "--banner:js=const __glob = () => ({});"
ROOT="$ROOT" node --experimental-sqlite --no-warnings "$OUT/today.mjs"
npx --prefix "$ROOT" esbuild "$ROOT/scripts/contacts-test/overview.ts" --bundle --platform=node --format=esm --outfile="$OUT/overview.mjs" --external:node:sqlite --log-level=error --define:import.meta.glob=__glob "--banner:js=const __glob = () => ({});"
ROOT="$ROOT" node --experimental-sqlite --no-warnings "$OUT/overview.mjs"
npx --prefix "$ROOT" esbuild "$ROOT/scripts/contacts-test/access-matrix.ts" --bundle --platform=node --format=esm --outfile="$OUT/access-matrix.mjs" --log-level=error
ROOT="$ROOT" node --no-warnings "$OUT/access-matrix.mjs"
npx --prefix "$ROOT" esbuild "$ROOT/scripts/contacts-test/origin-check.ts" --bundle --platform=node --format=esm --outfile="$OUT/origin-check.mjs" --log-level=error
ROOT="$ROOT" node --no-warnings "$OUT/origin-check.mjs"
npx --prefix "$ROOT" esbuild "$ROOT/scripts/contacts-test/speed.ts" --bundle --platform=node --format=esm --outfile="$OUT/speed.mjs" --external:node:sqlite --log-level=error --define:import.meta.glob=__glob "--banner:js=const __glob = () => ({});"
ROOT="$ROOT" node --experimental-sqlite --no-warnings "$OUT/speed.mjs"
npx --prefix "$ROOT" esbuild "$ROOT/scripts/contacts-test/admin-search.ts" --bundle --platform=node --format=esm --outfile="$OUT/admin-search.mjs" --external:node:sqlite --log-level=error
ROOT="$ROOT" node --experimental-sqlite --no-warnings "$OUT/admin-search.mjs"
npx --prefix "$ROOT" esbuild "$ROOT/scripts/contacts-test/notifications.ts" --bundle --platform=node --format=esm --outfile="$OUT/notifications.mjs" --external:node:sqlite --log-level=error --define:import.meta.glob=__glob "--banner:js=const __glob = () => ({});"
ROOT="$ROOT" node --experimental-sqlite --no-warnings "$OUT/notifications.mjs"
