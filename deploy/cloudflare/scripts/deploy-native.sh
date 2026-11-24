#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../../.."

if [[ "${1:-}" == --dry-run && "$#" == 1 ]]; then
  npm run deploy -- --dry-run
  exit
fi

if [[ "$#" != 0 ]]; then
  echo "Usage: npm run cloudflare:deploy -- [--dry-run]" >&2
  exit 2
fi

: "${RENDER_TOKEN:?Set RENDER_TOKEN to protect the renderer endpoint}"
npm run deploy
printf '%s' "$RENDER_TOKEN" | npx --yes wrangler@4.167.0 secret put RENDER_TOKEN
