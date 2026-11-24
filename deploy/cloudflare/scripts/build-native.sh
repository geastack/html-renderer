#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../../.."
app="$PWD"
server="$app/deploy/cloudflare/src/native"
export CXX="${CXX:-clang++}"
export GEA_COMPILER_DIR="$app/node_modules/@geastack/compiler"
export GEA_NODE_COMPAT_ROOT="$app/node_modules/@geastack/node-compat"
export GEA_LINUX_OUTPUT_DIR="$app/dist/native"
out="$GEA_LINUX_OUTPUT_DIR/html-renderer/build"

node deploy/cloudflare/scripts/emit-native.mjs "$out"

export GEA_LINUX_PRERENDER_HTTP_SOURCE="$out/server.cpp"
export GEA_LINUX_PRERENDER_HTTP_INCLUDE="$server"
GEA_HTML_INPUT="$app/fixtures/card/card.html" node node_modules/@geastack/cli/bin/gea.mjs \
  prerender --project "$app" --app html-renderer --width 480 --height 220 \
  --out "$app/dist/native-build-smoke.png"

node --input-type=module - <<'JS'
import { readFileSync } from 'node:fs'
import { PNG } from 'pngjs'

const { data, width } = PNG.sync.read(readFileSync('dist/native-build-smoke.png'))
const shades = new Set()

// The Card title uses the loaded Barlow face over a solid background.
for (let y = 49; y < 83; y++) {
  for (let x = 42; x < 225; x++) {
    shades.add(data.readUInt32BE((y * width + x) * 4))
  }
}

if (shades.size < 8) {
  throw new Error('The Card smoke render fell back to bitmap text')
}
JS

"$GEA_LINUX_OUTPUT_DIR/html-renderer/html-renderer" --gea-prerender-http &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true' EXIT

node --input-type=module - <<'JS'
import { setTimeout as delay } from 'node:timers/promises'

for (let attempt = 0; attempt < 50; attempt++) {
  const response = await fetch('http://127.0.0.1:8080/health', {
    signal: AbortSignal.timeout(1000),
  }).catch(() => undefined)

  if (response?.ok) {
    process.exit(0)
  }

  await delay(100)
}

throw new Error('The built executable did not serve /health in HTTP mode.')
JS
