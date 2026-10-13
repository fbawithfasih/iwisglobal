#!/bin/sh
# Runs the WhatsApp reply agent evaluation (see run.ts). From the repo root:
#   export $(grep ANTHROPIC_API_KEY .env) && sh scripts/wa-eval/run.sh
# Needs Node 22.5 or newer (node:sqlite). Makes real model calls, about two per
# question. tours.json is a snapshot of the published tours' prices; refresh it
# when prices change.
set -e
OUT=$(mktemp -d)
npx esbuild scripts/wa-eval/run.ts --bundle --platform=node --format=esm --outfile="$OUT/run.mjs" --log-level=error
# The translation loader uses a Vite-only glob that plain Node lacks; the
# evaluation is English-only, so an empty object stands in for it.
sed -i.bak 's#import\.meta\.glob([^)]*)#{}#' "$OUT/run.mjs"
node --no-warnings "$OUT/run.mjs"
