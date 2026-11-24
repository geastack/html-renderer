#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
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
  : "${RENDER_TOKEN:?Set RENDER_TOKEN to protect the renderer endpoint}"
fi

if "$build"; then
  bash scripts/build-in-docker.sh
fi

if [[ ! -x ../../dist/cloudflare/html-renderer ]]; then
  echo "Missing executable at dist/cloudflare/html-renderer. Run without --skip-build to build it." >&2
  exit 1
fi

wrangler=(npx --yes wrangler@4.167.0)
config=wrangler.jsonc
if "$dry_run"; then
  "${wrangler[@]}" deploy --config "$config" --dry-run
else
  "${wrangler[@]}" deploy --config "$config"
  printf '%s' "$RENDER_TOKEN" | "${wrangler[@]}" secret put RENDER_TOKEN --config "$config"
fi
