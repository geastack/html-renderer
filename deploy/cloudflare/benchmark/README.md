# Cloudflare renderer benchmark

The container serves the bundled Card and Promo fixtures as 1920 × 1080 PNGs.
It runs Gea, Playwright, and direct headless Chrome in the same container.
Playwright and direct Chrome use the same pinned browser executable.

## Benchmark on macOS

From the renderer checkout, run `npm ci --ignore-scripts` and build the
native renderer with `npm run render -- fixtures/card/card.html --out dist/card.png`.
Then run:

```sh
node deploy/cloudflare/benchmark/benchmark-local.mjs
```

Set `GEA_RENDERER` to use an existing native worker or `CHROME_PATH` to use
a different Chrome installation. Playwright and direct CDP use the same
Chrome binary. Run on a quiet machine. Each fixture uses five fresh-process
captures and 20 samples each for reuse and remount. Wall time ends when a
1920 × 1080 PNG is written. CPU and peak RSS are sampled from the renderer
process tree using macOS `ps`. Its CPU counters have 10 ms resolution.

## Run locally

From the HTML Renderer repository root:

```sh
docker build --platform linux/amd64 -t gea-render-benchmark -f deploy/cloudflare/benchmark/Dockerfile .
docker run --rm --platform linux/amd64 --cpus=1 \
  -p 127.0.0.1:8080:8080 gea-render-benchmark
```

In another shell:

```sh
node deploy/cloudflare/benchmark/benchmark.mjs http://127.0.0.1:8080 20
```

## Deploy with Wrangler

Run these commands from `deploy/cloudflare/benchmark` with Docker running and Wrangler
authenticated to a Cloudflare account with Containers enabled.

```sh
npm ci
wrangler deploy
wrangler secret put BENCHMARK_TOKEN
```

Set the same token as `BENCHMARK_TOKEN` in your benchmark shell and use the Worker URL printed
by Wrangler:

```sh
node benchmark.mjs https://gea-render-benchmark.YOUR-SUBDOMAIN.workers.dev 20
```

The Worker uses one `standard-2` container and stops it after two idle
minutes. It requires the bearer token for requests. The container serves
only the bundled fixtures.

## Read the results

`/health` lists the fixtures and engine modes. For example, GET
`/render?fixture=card&engine=gea-warm` returns a PNG and a `Server-Timing`
duration. The benchmark sends requests serially, discards two warmups
per fixture and mode, and reports render and HTTP medians and p95s.

| Mode            | What is measured                                      |
| --------------- | ----------------------------------------------------- |
| Gea cold        | Launch native worker, mount, capture, and close       |
| Gea warm        | Capture again with the worker and mounted page reused |
| Playwright cold | Launch browser, load page, capture, and close         |
| Playwright warm | Capture again with the browser and page reused        |
| Chrome cold     | Run the Chrome screenshot command with a new profile  |

The server timing includes PNG generation and reading the finished file.
HTTP timing also includes request handling and download. The warmup requests
start the container before measurements, so the table does not include
Cloudflare container startup. The two fixtures are for timing comparisons,
and the visual diff suite covers fidelity separately.

## CPU and memory

Run the resource sampler against the same endpoint:

```sh
node resources.mjs https://gea-render-benchmark.YOUR-SUBDOMAIN.workers.dev
```

The sampler runs five measured captures per mode and fixture after two
warmups. CPU is the change in Linux cgroup CPU time during the capture,
including child processes. Memory is the container's anonymous and shared
memory, excluding regular file cache. The sampler records the starting
value and estimates the peak at 10 ms intervals. It closes any previously
reused browser or renderer before switching modes.

## Run the browser Lite compatibility check

The Lite service uses the same 1920 × 1080 fixtures as the
[native service](../README.md). Both browser drivers use the same Chrome Headless Shell binary in single-process mode. Playwright controls one page through its own API.
The direct Chrome run launches the executable and controls one tab through
the Chrome DevTools Protocol.

From the HTML Renderer repository root, build the browser base:

```sh
docker build --platform linux/amd64 -t gea-browser-benchmark-base:local -f deploy/cloudflare/benchmark/Dockerfile .
```

Then deploy the Lite service:

```sh
cd deploy/cloudflare
npm ci
wrangler deploy --config wrangler.browser-lite.jsonc
wrangler secret put BENCHMARK_TOKEN --config wrangler.browser-lite.jsonc
```

Set `BENCHMARK_TOKEN` and use the Worker URL to run both drivers.
Both browser drivers failed to produce an initial PNG on Lite. Use Basic
for the browser latency and resource comparison.

```sh
node benchmark-native.mjs "$BROWSER_WORKER_URL" 3 20 playwright
node benchmark-native.mjs "$BROWSER_WORKER_URL" 3 20 chrome
```

For the interleaved comparison with timing at each hop, set
`BENCHMARK_NATIVE_URL`, `BENCHMARK_BROWSER_URL`, and `BENCHMARK_TOKEN`, then
run `node benchmark-http.mjs` from this directory. It writes one JSON row
per engine, fixture, and mode.

Each cold sample starts a new container and browser. Reuse captures the
already-loaded page. Remount navigates the same tab to the fixture again.
Capture time ends when the PNG bytes are ready. It includes PNG encoding
and browser protocol work. HTTP latency includes the image download and,
for cold samples, Cloudflare startup.

## Compare on Cloudflare Basic

The Basic browser deployment uses full Chrome for Testing in headless mode.
Both Basic configurations start each container from its Durable Object with
the `basic` instance type. This places the container and its Durable Object
together. Use Wrangler 4.167.0 or a newer version that supports this scheduling
policy. Build the same browser base image as above and the native artifacts
from the [native deployment guide](../README.md), then deploy both services from
this directory.

```sh
wrangler deploy --config wrangler.browser-basic.jsonc
wrangler secret put BENCHMARK_TOKEN --config wrangler.browser-basic.jsonc
wrangler deploy --config wrangler.native-basic.jsonc
wrangler secret put BENCHMARK_TOKEN --config wrangler.native-basic.jsonc
```

```sh
node benchmark-native.mjs "$NATIVE_WORKER_URL" 3 20
node benchmark-native.mjs "$BROWSER_WORKER_URL" 3 20 playwright
node benchmark-native.mjs "$BROWSER_WORKER_URL" 3 20 chrome
```

For the interleaved comparison with timing at each hop, set
`BENCHMARK_NATIVE_URL`, `BENCHMARK_BROWSER_URL`, and `BENCHMARK_TOKEN`, then
run `node benchmark-http.mjs` from this directory. It writes one JSON row
per engine, fixture, and mode.

## Instance configurations and cost

| Configuration                         | vCPU |     RAM | Disk | Cloudflare result                                                                                                                                                                           |
| ------------------------------------- | ---: | ------: | ---: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gea on Lite                           | 1/16 | 256 MiB | 2 GB | Completed all modes. One native process in a 46 MiB runtime image.                                                                                                                          |
| Playwright and direct Chrome on Lite  | 1/16 | 256 MiB | 2 GB | Neither driver completed its first capture, including trials with Chrome Headless Shell.                                                                                                    |
| Gea on Basic                          |  1/4 |   1 GiB | 4 GB | Completed all modes with the same native image as Lite.                                                                                                                                     |
| Playwright and direct Chrome on Basic |  1/4 |   1 GiB | 4 GB | Completed all modes. Both used full Chrome for Testing 159.0.8154.6 on Ubuntu 24.04, with GPU and browser sandbox disabled. Playwright 1.65.1 used its own API, and direct Chrome used CDP. |

All four configurations use the same authenticated Worker and Durable Object routing code. The benchmark starts a fresh container for each cold sample and reuses one container for each warm sequence. The idle timeout is two minutes. The Standard-2 deployment is a separate benchmark harness.

### Estimated container charges in USD

Rates verified on November 24, 2026. The Workers Paid plan starts at $5 per month. It includes 25 GiB-hours of container RAM, 375 vCPU-minutes and 200 GB-hours of container disk per month. Above those allowances, RAM costs $0.0000025 per GiB-second, disk costs $0.00000007 per GB-second, and CPU costs $0.000020 per active vCPU-second. RAM and disk are billed at the provisioned capacity while the instance is running. [Cloudflare Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/)

| Tier  | Provisioned RAM and disk per running hour | RAM and disk for two idle minutes |
| ----- | ----------------------------------------: | --------------------------------: |
| Lite  |                                 $0.002754 |                        $0.0000918 |
| Basic |                                 $0.010008 |                        $0.0003336 |

## HTTP comparison after colocating containers

The old default scheduler could place a container separately from its Durable
Object. On the slow native probe, the Worker-only ping took 16.7 ms median
from the client. The Durable Object ping took 37.1 ms. Card's median time to
headers was 147.1 ms, with 110 ms inside the Durable Object around the
container call and 0.87 ms inside the renderer. Promo showed the same delay
on that placement. The earlier benchmark did not retain the object ID, so
this diagnostic reproduces the symptom on a new instance.
[Cloudflare container placement](https://developers.cloudflare.com/containers/concepts/placement/)

Across eight fresh native instances under each scheduling policy, the
Card warm Durable Object–container hop had an instance-median range of
2.8–108.3 ms before and 0.7–2.6 ms after.
The Basic configurations now use Durable Object scheduling on both engines.
Each object starts its container with the named `basic` instance, waits
for its health endpoint, and sets a two-minute inactivity timeout.

The table uses 3 cold and 20 samples per warm mode, per fixture and engine.
All requests used the TXL edge and reused client HTTPS connections. Stage
durations are calculated per request from nested timers, then summarized.
Client–Worker includes edge transport. Worker–DO includes forwarding to the
object. DO–container includes readiness and provisioning on cold starts.
Container time covers the application request up to response creation.
Capture and CPU cover only the measured capture interval. PNG download
runs from response headers to the final byte. RAM is anonymous and shared
memory excluding file cache. Cold p95 is the maximum of three samples.

| Fixture | Mode       | Engine     | Client–Worker ms p50 / p95 | Worker–DO ms p50 / p95 | DO–container ms p50 / p95 | Container ms p50 / p95 | Capture ms p50 / p95 | Download ms p50 / p95 | HTTP ms p50 / p95 | CPU ms p50 / p95 | RAM before MiB p50 | RAM peak MiB p50 / max | PNG bytes |
| ------- | ---------- | ---------- | -------------------------: | ---------------------: | ------------------------: | ---------------------: | -------------------: | --------------------: | ----------------: | ---------------: | -----------------: | ---------------------: | --------: |
| Card    | Cold start | Gea        |                19.4 / 36.3 |            18.0 / 44.0 |            344.7 / 1111.3 |       84.344 / 138.661 |     84.147 / 138.365 |             2.2 / 4.1 |    466.4 / 1311.8 |     80.1 / 133.9 |                2.7 |            12.1 / 12.1 |     18221 |
| Card    | Cold start | Playwright |                13.6 / 18.7 |            34.0 / 43.0 |           699.5 / 10744.7 |    3441.275 / 3532.504 |  3440.653 / 3531.840 |             2.6 / 3.5 |  4292.1 / 14239.2 |  2592.8 / 2646.0 |               15.2 |          230.5 / 232.7 |     16388 |
| Card    | Cold start | Chrome     |                18.6 / 42.8 |            21.0 / 21.0 |          5601.1 / 11817.6 |    2099.429 / 2190.896 |  2098.872 / 2190.375 |             0.3 / 0.6 |  7526.0 / 13981.4 |  1487.7 / 1572.2 |               15.3 |          232.2 / 233.2 |     16388 |
| Card    | Reuse      | Gea        |                14.8 / 20.8 |            18.0 / 20.0 |                 1.8 / 2.8 |          0.243 / 0.286 |        0.160 / 0.184 |             0.1 / 2.2 |       35.6 / 41.3 |        0.2 / 0.3 |               12.2 |            12.2 / 12.3 |     18221 |
| Card    | Reuse      | Playwright |                15.2 / 19.5 |            17.0 / 23.0 |                 1.9 / 2.3 |       79.089 / 131.714 |     78.650 / 131.423 |            0.1 / 39.0 |     122.3 / 214.5 |      56.4 / 69.4 |              241.3 |          272.7 / 290.8 |     16388 |
| Card    | Reuse      | Chrome     |                14.7 / 19.6 |            17.0 / 24.0 |                 2.1 / 2.9 |        51.542 / 80.679 |      50.393 / 64.037 |             0.1 / 0.7 |      87.5 / 119.7 |      42.4 / 50.4 |              218.5 |          236.1 / 248.4 |     16388 |
| Card    | Remount    | Gea        |                15.8 / 20.8 |            15.0 / 24.0 |                 2.3 / 2.8 |        66.518 / 81.192 |      66.411 / 81.096 |            0.1 / 32.2 |     102.1 / 146.9 |      64.5 / 67.5 |               12.3 |            12.3 / 12.3 |     18221 |
| Card    | Remount    | Playwright |                14.9 / 18.7 |            16.0 / 22.0 |                 1.9 / 3.0 |      251.564 / 431.127 |    251.225 / 430.629 |             0.1 / 1.5 |     295.8 / 463.4 |    125.2 / 167.7 |              256.9 |          262.1 / 277.7 |     16388 |
| Card    | Remount    | Chrome     |                15.4 / 19.2 |            18.0 / 25.0 |                 2.4 / 4.0 |      231.929 / 312.236 |    229.846 / 311.971 |             0.1 / 0.3 |     278.3 / 357.0 |    104.4 / 119.3 |              220.4 |          237.3 / 253.4 |     16388 |
| Promo   | Cold start | Gea        |                14.2 / 16.1 |            18.0 / 43.0 |             342.2 / 355.4 |      118.559 / 175.839 |    118.376 / 175.499 |            8.3 / 16.4 |     514.5 / 590.9 |    115.8 / 171.1 |                2.7 |            14.1 / 14.2 |     66716 |
| Promo   | Cold start | Playwright |                19.3 / 19.8 |            34.0 / 35.0 |             694.8 / 707.8 |    3595.166 / 3637.177 |  3594.185 / 3635.931 |           30.3 / 34.1 |   4374.1 / 4433.4 |  2715.9 / 2744.4 |               15.2 |          232.7 / 236.9 |     90161 |
| Promo   | Cold start | Chrome     |                22.4 / 22.4 |            23.0 / 43.0 |             692.0 / 716.3 |    2291.975 / 3461.709 |  2291.395 / 3460.555 |            9.9 / 43.7 |   3033.8 / 4287.0 |  1672.0 / 2585.2 |               15.2 |          246.8 / 246.9 |     90161 |
| Promo   | Reuse      | Gea        |                15.3 / 29.8 |            17.0 / 20.0 |                 1.7 / 1.7 |          0.279 / 0.351 |        0.175 / 0.232 |            5.4 / 13.6 |       41.2 / 58.9 |        0.2 / 0.3 |               14.6 |            14.6 / 14.8 |     66716 |
| Promo   | Reuse      | Playwright |                18.4 / 63.8 |            33.0 / 35.0 |                 2.5 / 5.0 |      263.058 / 323.346 |    262.308 / 322.322 |           15.3 / 37.5 |     344.5 / 415.2 |    107.6 / 126.0 |              255.0 |          274.1 / 292.4 |     90161 |
| Promo   | Reuse      | Chrome     |                18.6 / 94.3 |            17.0 / 21.0 |                 2.2 / 3.6 |       78.777 / 114.401 |     75.156 / 113.197 |            7.7 / 80.9 |     129.4 / 259.6 |      58.6 / 66.9 |              222.1 |          237.4 / 258.3 |     90161 |
| Promo   | Remount    | Gea        |                14.8 / 21.1 |            18.0 / 20.0 |                 1.5 / 2.4 |      147.768 / 237.534 |    147.629 / 237.359 |            6.4 / 73.8 |     201.3 / 278.0 |     93.1 / 103.3 |               14.6 |            14.6 / 14.8 |     66716 |
| Promo   | Remount    | Playwright |                18.0 / 28.0 |            32.0 / 33.0 |                 2.8 / 3.5 |    1140.427 / 1309.507 |  1132.456 / 1308.959 |           13.1 / 33.2 |   1260.5 / 1380.7 |    341.2 / 376.5 |              257.5 |          275.3 / 294.8 |     90161 |
| Promo   | Remount    | Chrome     |                18.6 / 29.4 |            17.0 / 21.0 |                 2.3 / 3.4 |      394.540 / 508.545 |    388.634 / 504.952 |            7.1 / 63.7 |     439.4 / 555.6 |    145.6 / 168.8 |              211.6 |          239.5 / 260.8 |     90161 |

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
