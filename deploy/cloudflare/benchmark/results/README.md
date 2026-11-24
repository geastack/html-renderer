# Benchmark results · November 24, 2026

## Cloudflare Basic · Gea 0.0.7, Chrome, and Playwright

This run interleaved the published 0.0.7 source build, the previous Gea deployment, direct Chrome, and Playwright. All requests went through the TXL edge. Each fixture and engine used eight cold starts and 30 samples per warm mode at 1920 × 1080. The two Gea deployments returned byte-identical PNGs. The browser drivers used the same Chrome binary. The [JSONL](cloudflare-basic-0.0.7.jsonl) includes every sample, its PNG hash, and p50 and p95 summaries.

Each cell shows median capture ms / HTTP ms / CPU ms / peak container memory MiB. Memory sums anonymous and shared memory.

| Fixture | Mode       |                    Gea 0.0.7 |                       Direct Chrome |                          Playwright |
| ------- | ---------- | ---------------------------: | ----------------------------------: | ----------------------------------: |
| Card    | Cold start |   99.1 / 517.2 / 97.9 / 12.1 | 2,394.3 / 3,169.6 / 1,688.0 / 230.8 | 2,765.9 / 3,525.3 / 1,927.2 / 230.9 |
| Card    | Remount    |  157.1 / 201.8 / 80.3 / 12.2 |   1,347.6 / 1,447.7 / 396.4 / 206.3 |       390.6 / 438.1 / 150.6 / 258.6 |
| Promo   | Cold start | 138.3 / 551.0 / 133.4 / 14.2 | 2,455.4 / 3,239.5 / 1,764.7 / 239.4 | 6,388.2 / 7,461.1 / 5,054.3 / 246.8 |
| Promo   | Remount    | 557.5 / 593.9 / 193.0 / 14.7 |       489.6 / 551.2 / 166.9 / 230.1 |       446.7 / 503.7 / 168.0 / 279.3 |

### Performance check against the previous Gea deployment

**Equivalence was not demonstrated in this run.** Card remount capture was 157.1 ms versus 141.5 ms. Promo remount capture was 557.5 ms versus 222.2 ms, and capture CPU was 193.0 ms versus 100.4 ms. The sample shows a regression for this configuration. Separately provisioned containers limit what the test can establish about the cause.

| Fixture | Mode       | Capture p50 / p95, previous → 0.0.7 (ms) | CPU p50, previous → 0.0.7 (ms) | HTTP p50 / p95, previous → 0.0.7 (ms) | Peak memory p50, previous → 0.0.7 (MiB) |
| ------- | ---------- | ---------------------------------------: | -----------------------------: | ------------------------------------: | --------------------------------------: |
| Card    | Cold start |     100.642 / 256.186 → 99.059 / 216.806 |                    99.6 → 97.9 |       549.0 / 1277.4 → 517.2 / 1587.0 |                             12.0 → 12.1 |
| Card    | Remount    |    141.474 / 175.083 → 157.101 / 176.137 |                    81.6 → 80.3 |         203.1 / 248.0 → 201.8 / 281.6 |                             12.3 → 12.2 |
| Promo   | Cold start |    135.661 / 345.895 → 138.286 / 220.654 |                  131.5 → 133.4 |        780.9 / 1135.8 → 551.0 / 883.2 |                             14.0 → 14.2 |
| Promo   | Remount    |    222.200 / 306.386 → 557.452 / 753.972 |                  100.4 → 193.0 |         270.9 / 351.1 → 593.9 / 791.2 |                             14.7 → 14.7 |

## Earlier measurements

### Cloudflare Lite and Basic

The npm-only Linux executable used Core 0.1.60, Linux 0.1.8, and node-compat 1.0.22. Card and Promo were 1920 × 1080. Each tier and fixture used three cold starts and 20 samples per warm mode. The unified and previous native binaries produced byte-identical PNGs. The JSONL files contain both binaries and include p95, hop times, and download times.

Cells show median capture ms / HTTP ms / CPU ms / peak cgroup memory MiB. The memory counter sums anonymous and shared memory. Capture ends when the PNG is ready.

| Fixture | Mode       |                           Lite |                           Basic |
| ------- | ---------- | -----------------------------: | ------------------------------: |
| Card    | Cold start |   84.769 / 738.9 / 82.6 / 12.2 | 107.019 / 2467.2 / 105.1 / 12.1 |
| Card    | Remount    |   69.924 / 124.5 / 68.4 / 12.2 |  108.585 / 149.2 / 101.6 / 12.2 |
| Promo   | Cold start | 114.624 / 860.8 / 112.6 / 14.3 |  122.278 / 523.9 / 119.5 / 14.2 |
| Promo   | Remount    |   89.322 / 163.7 / 88.5 / 14.6 |  136.252 / 217.6 / 120.6 / 14.6 |

### Local Apple Silicon

Apple M4 Max with 128 GB RAM. CPU idle was 78–87% before the run. Gea used the macOS 0.0.6 native artifact. Direct CDP and Playwright 1.65.1 both used Chrome 158.0.8127.88. Each fixture and engine used five cold starts and 20 samples per warm mode.

Cells show median wall ms / CPU ms / summed process-tree peak RSS MiB. Wall time ends when the PNG is written. macOS process sampling has 10 ms CPU resolution, and RSS can count shared pages more than once. The Playwright Card cold samples produced two distinct PNG hashes.

| Fixture | Mode       |               Gea |         Direct Chrome |           Playwright |
| ------- | ---------- | ----------------: | --------------------: | -------------------: |
| Card    | Cold start | 53.3 / 140 / 40.4 |  434.9 / 1070 / 873.5 | 503.1 / 1000 / 651.2 |
| Card    | Remount    |  37.1 / 50 / 44.0 |    83.5 / 160 / 901.0 |   73.9 / 190 / 714.7 |
| Promo   | Cold start | 75.3 / 170 / 40.6 | 1323.4 / 2510 / 895.3 | 564.2 / 1140 / 673.3 |
| Promo   | Remount    | 58.0 / 160 / 47.6 |   105.9 / 250 / 940.4 |   93.5 / 250 / 752.0 |
