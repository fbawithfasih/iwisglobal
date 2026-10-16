#!/bin/sh
# Runs the Hotelbeds certification scenarios against the TEST API (see run.ts).
# From the repo root:   export HOTELBEDS_API_KEY=... HOTELBEDS_SECRET=...  &&  sh scripts/hotelbeds-cert/run.sh
set -e
OUT=$(mktemp -d)
npx esbuild scripts/hotelbeds-cert/run.ts --bundle --platform=node --format=esm --outfile="$OUT/run.mjs" --log-level=error
node --no-warnings "$OUT/run.mjs"
