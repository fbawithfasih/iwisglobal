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
