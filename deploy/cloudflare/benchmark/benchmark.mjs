import { setTimeout } from 'node:timers/promises'

const base = process.argv[2] ?? 'http://127.0.0.1:8080'
const samples = Number(process.argv[3] ?? 20)
const token = process.env.BENCHMARK_TOKEN
const headers = token ? { Authorization: `Bearer ${token}` } : undefined

if (!Number.isInteger(samples) || samples < 1) {
  throw new Error('Pass a positive sample count')
}

async function request(path) {
  const response = await fetch(new URL(path, base), {
    headers,
    signal: AbortSignal.timeout(120_000),
  })

  if (!response.ok) {
    throw new Error(`${path}: HTTP ${response.status} ${await response.text()}`)
  }

  return response
}

const health = await (await request('/health')).json()
const results = []
const percentile = (values, level) => {
  const sorted = [...values].sort((a, b) => a - b)

  return sorted[Math.ceil(sorted.length * level) - 1].toFixed(1)
}

for (const fixture of health.fixtures) {
  for (const engine of health.modes) {
    const render = []
    const total = []
    let size = 0

    for (let i = -2; i < samples; i++) {
      const start = performance.now()
      const response = await request(`/render?fixture=${fixture}&engine=${engine}`)
      const png = await response.arrayBuffer()
      const timing = /(?:^|,\s*)render;dur=([\d.]+)/.exec(
        response.headers.get('Server-Timing') ?? '',
      )
      const elapsed = performance.now() - start
      const view = new DataView(png)

      if (
        !timing ||
        view.getUint32(16) !== health.viewport.width ||
        view.getUint32(20) !== health.viewport.height
      ) {
        throw new Error(`${fixture}/${engine}: invalid timing or PNG dimensions`)
      }

      if (i >= 0) {
        render.push(Number(timing[1]))
        total.push(elapsed)
        size += png.byteLength
      }

      await setTimeout(10)
    }

    results.push({
      fixture,
      engine,
      'render p50 ms': percentile(render, 0.5),
      'render p95 ms': percentile(render, 0.95),
      'HTTP p50 ms': percentile(total, 0.5),
      'HTTP p95 ms': percentile(total, 0.95),
      'mean PNG bytes': Math.round(size / samples),
    })
  }
}

console.log(
  `${health.platform}/${health.arch}, ${health.viewport.width} × ${health.viewport.height}, ${samples} samples per mode`,
)
console.table(results)
