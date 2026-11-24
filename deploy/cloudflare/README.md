# Deploy Gea HTML Renderer to Cloudflare

This guide deploys the native PNG service. It runs one renderer process and
serves the bundled Card and Promo fixtures. For the separate Playwright and
Chrome service, see [Browser benchmark](BROWSER-BENCHMARK.md).

## Deploy the Lite service

From the HTML Renderer repository root in a Gea workspace on Linux x86-64,
install the project dependencies with `npm ci`. The workspace needs a built
Gea compiler, the Gea CLI, the Linux target, and node-compat. Install Clang,
pkg-config, and the SDL2, FreeType, libpng, and libcurl development packages.
Start Docker and authenticate Wrangler to the Cloudflare account with
Containers enabled. Set `BENCHMARK_TOKEN` in your shell to protect the
endpoint.

```sh
npm run cloudflare:deploy
```

The command builds the Linux renderer, deploys the colocated Lite container,
sets its bearer token, and prints the Worker URL. Geatsc compiles the TypeScript
HTTP server in `src/native/server.ts`. The Linux target links the generated
server and renderer into one executable. The `scratch` image contains that
executable, its system libraries, and the fixtures. Node is used by the
build and deployment tools.

Use `npm run cloudflare:deploy -- --skip-build` to deploy an existing Linux
build. Add `--dry-run` to bundle and validate the Worker without uploading it.

## Measure

Set `BENCHMARK_TOKEN` in your shell to the value you entered during deploy.
Then run this from `deploy/cloudflare` using the Worker URL.

```sh
node benchmark-native.mjs https://gea-render-native-colocated-lite.YOUR-SUBDOMAIN.workers.dev
```

The benchmark reports HTTP latency, capture time, cgroup CPU time, and
container memory for three modes.

| Mode                | What it measures                                        |
| ------------------- | ------------------------------------------------------- |
| Cold start          | Start a fresh container and request its first PNG       |
| Mounted page reused | Return the encoded PNG for the already-mounted fixture  |
| Page remounted      | Reload the fixture and capture in the running container |

HTTP latency includes the PNG download. Cold starts and remounts render and
encode the PNG. Reuse returns the encoded PNG retained from the last capture.
Mounting any fixture clears the previous PNG. CPU covers the capture interval.
RAM is cgroup anonymous and shared memory, with the peak sampled every 5 ms.

The script stops each benchmark instance when it finishes using it.
The Worker requires a bearer token for all requests. Use `GET /health` for
a health check and `GET /card` or `GET /promo` for a PNG.

### Colocated Lite versus Basic

Both services use the same Gea image and place the container with its
Durable Object. Lite requests 1/16 vCPU and 256 MiB RAM. Basic requests
1/4 vCPU and 1 GiB RAM.

The benchmark alternates tiers from the same client through the TXL edge
using existing HTTPS connections. It uses three cold starts and 20 requests
in each warm mode per fixture and tier. Cold p95 is the slowest of three.
HTTP includes provisioning on cold starts. CPU covers capture only, and
RAM excludes file cache. The benchmark emits individual hop timings in its JSON output. All requests returned the same fixture PNG bytes across tiers
and modes.

Set `BENCHMARK_LITE_URL`, `BENCHMARK_NATIVE_URL` (Basic), and
`BENCHMARK_TOKEN`, then run `node benchmark-http.mjs` from this directory
to reproduce the comparison.

Chrome and Playwright results use the colocated Basic browser deployment. Both failed before the first PNG on Lite. Gea reuse serves a
cached PNG, and browser reuse captures the mounted tab again.

Each cell shows **HTTP p50 / p95 (ms) · CPU p50 (ms) · peak RAM (MiB) · estimated USD per million requests**.

Cost uses Cloudflare's overage rates for active CPU and provisioned RAM
and disk. The warm estimate assumes an already-running container receives
one request every two seconds. The cold estimate uses median HTTP time
as a proxy for billable uptime and assumes immediate shutdown. Both use
median capture CPU. Cold startup CPU outside capture is unavailable.
These estimates exclude the Workers Paid plan fee and included usage,
post-request idle time, Worker and Durable Object charges, and egress.
[Cloudflare Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/)

| Fixture | Mode       |                                  Gea Lite |                                Gea Basic |                            Direct Chrome Basic |                               Playwright Basic |
| ------- | ---------- | ----------------------------------------: | ---------------------------------------: | ---------------------------------------------: | ---------------------------------------------: |
| Card    | Cold start | 2537.8 / 3437.9 · 80.3 · 12.1 · **$3.55** |  471.5 / 563.6 · 94.1 · 12.1 · **$3.19** | 7526.0 / 13981.4 · 1487.7 · 233.2 · **$50.68** | 4292.1 / 14239.2 · 2592.8 · 232.7 · **$63.79** |
| Card    | Reuse      |      37.3 / 64.8 · 0.2 · 12.3 · **$1.53** |     33.7 / 38.6 · 0.2 · 12.2 · **$5.56** |        87.5 / 119.7 · 42.4 · 248.4 · **$6.41** |       122.3 / 214.5 · 56.4 · 290.8 · **$6.69** |
| Card    | Remount    |   108.8 / 133.8 · 69.0 · 12.3 · **$2.91** |  109.5 / 139.7 · 70.8 · 12.2 · **$6.98** |      278.3 / 357.0 · 104.4 · 253.4 · **$7.65** |      295.8 / 463.4 · 125.2 · 277.7 · **$8.06** |
| Promo   | Cold start |  498.6 / 972.4 · 110.7 · 14.2 · **$2.60** | 563.1 / 566.8 · 169.7 · 14.1 · **$4.96** |  3033.8 / 4287.0 · 1672.0 · 246.9 · **$41.87** |  4374.1 / 4433.4 · 2715.9 · 236.9 · **$66.48** |
| Promo   | Reuse      |      46.1 / 52.8 · 0.2 · 14.8 · **$1.53** |     40.8 / 48.6 · 0.3 · 14.8 · **$5.57** |       129.4 / 259.6 · 58.6 · 258.3 · **$6.73** |      344.5 / 415.2 · 107.6 · 292.4 · **$7.71** |
| Promo   | Remount    |   140.4 / 151.6 · 96.3 · 14.8 · **$3.46** |  143.2 / 150.2 · 98.4 · 14.8 · **$7.53** |      439.4 / 555.6 · 145.6 · 260.8 · **$8.47** |   1260.5 / 1380.7 · 341.2 · 294.8 · **$12.38** |
