#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../../.."
output="$PWD/dist/cloudflare"
mkdir -p "$output"
docker build --platform linux/amd64 \
  --build-arg "GEA_BUILD_JOBS=${GEA_BUILD_JOBS:-2}" \
  --file deploy/cloudflare/scripts/Dockerfile.build \
  --output "type=local,dest=$output" .
