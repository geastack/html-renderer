#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
app="$PWD"
workspace="$(dirname "$app")"
server="$app/deploy/cloudflare/src/native"
export CXX="${CXX:-clang++}"
export GEA_COMPILER_DIR="$workspace/compiler"
export GEA_NODE_COMPAT_ROOT="$workspace/node-compat"
export GEA_LINUX_OUTPUT_DIR="$app/dist/raspberry-pi-os"
out="$GEA_LINUX_OUTPUT_DIR/html-renderer/build"

node "$GEA_NODE_COMPAT_ROOT/scripts/build.mjs" "$server/server.ts" \
  --out "$out" --emit-only --host-plugin "$server/plugin.mjs" --entry-name gea_renderer_http_serve

export GEA_LINUX_PRERENDER_HTTP_SOURCE="$out/server.cpp"
export GEA_LINUX_PRERENDER_HTTP_INCLUDE="$server"
node scripts/render.mjs fixtures/card/card.html --out "$app/dist/native-build-smoke.png"
