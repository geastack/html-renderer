# Cloudflare renderer benchmark

The container serves the bundled Card and Promo fixtures as 1920 × 1080 PNGs.
It runs Gea, Playwright, and direct headless Chrome in the same container.
Playwright and direct Chrome use the same pinned browser executable.

## Results from the npm-only Cloudflare build

The [results](results/README.md) include the Cloudflare Basic three-engine
comparison, the Gea release checks, the local Apple Silicon comparison,
and the underlying JSONL.

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
captures and 20 remount samples. Wall time ends when a
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
`/render?fixture=card&engine=gea-cold` returns a PNG and a `Server-Timing`
duration. The benchmark sends requests serially, discards two warmups
per fixture and mode, and reports render and HTTP medians and p95s.

| Mode            | What is measured                                     |
| --------------- | ---------------------------------------------------- |
| Gea cold        | Launch native worker, mount, capture, and close      |
| Playwright cold | Launch browser, load page, capture, and close        |
| Chrome cold     | Run the Chrome screenshot command with a new profile |

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
value and estimates the peak at 10 ms intervals.

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

Each cold sample starts a new container. A remount
loads the fixture again inside the running renderer or browser.
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
| Gea on Lite                           | 1/16 | 256 MiB | 2 GB | Completed all modes with one native process.                                                                                                                                                |
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

## Reading the results

The Basic configurations use Durable Object scheduling. Each object starts
a container with the `basic` instance type and waits for it to be ready.
An optional `BENCHMARK_BASELINE_URL` adds another native Gea deployment to
the same interleaved test. The harness checks that the two Gea deployments
return byte-identical PNGs for each fixture.

Set `BENCHMARK_COLD_SAMPLES` and `BENCHMARK_WARM_SAMPLES` to set the sample
counts per fixture, engine, and mode. Defaults are three cold starts and
20 remounts. Set `BENCHMARK_INCLUDE_SAMPLES=1` to retain
individual timings and image hashes alongside the summaries.

Run `node benchmark-http.mjs --png-presets` to measure Gea's `fast` and
`compact` PNG encoders in separate containers. Set `BENCHMARK_NATIVE_URL`
to the tier being tested. Include `BENCHMARK_BROWSER_URL` when measuring
Chrome and Playwright on Basic. Leave it unset for the Gea-only Lite run.

Capture time ends when the PNG is ready. HTTP time includes transport and
download. Cold HTTP time also includes container startup. Each remount
produces a fresh PNG on all engines.
Memory is the container’s anonymous plus shared memory, excluding file cache.

## Gea and Chrome in the same Basic container

`wrangler.paired-basic.jsonc` runs the release Gea executable and direct
headless Chrome on the same Basic instance. Build the Gea and browser base
images above, deploy the paired configuration, and set `BENCHMARK_TOKEN`.
Send authenticated requests to `/paired/card` and `/paired/promo`. Use a
fresh UUID in `x-gea-benchmark-instance` for each container and reset it
with `POST /__benchmark/reset` when finished.

Each request alternates 12 warmed remounts per engine and returns each
PNG hash, in-container wall time, CPU time, and cgroup throttling counters.
Wall time includes receiving the PNG within the container. Keep the edge
HTTP time separate. See the [paired benchmark results](results/cloudflare-basic-paired.jsonl).
