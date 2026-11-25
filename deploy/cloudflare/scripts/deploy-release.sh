#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../../.."

version=$(node -p 'require("./package.json").version')
asset=gea-html-renderer-container-linux-x64.tar.gz
output=dist/cloudflare
mkdir -p "$output"

curl --fail --silent --show-error --location --retry 3 \
  "https://github.com/geastack/html-renderer/releases/download/renderer-v$version/$asset" \
  --output "$output/$asset"
docker load --input "$output/$asset"
container=$(docker create --platform linux/amd64 "gea-html-renderer:$version")
trap 'docker rm "$container" >/dev/null' EXIT
docker export "$container" --output "$output/renderer-rootfs.tar"

npx --yes wrangler@4.167.0 deploy "$@"
