#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
build=true
dry_run=false
for option in "$@"; do
  case "$option" in
    --skip-build) build=false ;;
    --dry-run) dry_run=true ;;
    *) echo "Usage: npm run cloudflare:deploy -- [--skip-build] [--dry-run]" >&2; exit 2 ;;
  esac
done

if ! "$dry_run"; then
  : "${BENCHMARK_TOKEN:?Set BENCHMARK_TOKEN to protect the renderer endpoint}"
fi

if "$build"; then
  bash build-native.sh
fi

npm ci --no-audit
wrangler=(npx --yes wrangler@4.167.0)
config=wrangler.native.jsonc
if "$dry_run"; then
  "${wrangler[@]}" deploy --config "$config" --dry-run
else
  "${wrangler[@]}" deploy --config "$config"
  printf '%s' "$BENCHMARK_TOKEN" | "${wrangler[@]}" secret put BENCHMARK_TOKEN --config "$config"
fi
