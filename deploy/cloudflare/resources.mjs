const [base = 'http://127.0.0.1:8080'] = process.argv.slice(2)
const token = process.env.BENCHMARK_TOKEN
const options = () => ({
  headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  signal: AbortSignal.timeout(90_000),
})

async function request(path) {
  const response = await fetch(new URL(path, base), options())

  if (!response.ok) {
    throw new Error(`${path}: HTTP ${response.status} ${await response.text()}`)
  }

  return response
}

const { fixtures, modes, viewport } = await (await request('/health')).json()
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const format = (value) => value.toFixed(1)
const rows = []

for (const fixture of fixtures) {
  for (const engine of modes) {
    const samples = []

    for (let i = -2; i < 5; i++) {
      const response = await request(`/render?fixture=${fixture}&engine=${engine}&profile=1`)

      await response.arrayBuffer()
      const resource = JSON.parse(response.headers.get('X-Render-Resources'))

      if (
        !resource ||
        ![resource.cpuMs, resource.baselineMiB, resource.peakMiB].every(Number.isFinite)
      ) {
        throw new Error('Container did not return valid resource counters')
      }

      if (i >= 0) {
        samples.push(resource)
      }
    }

    rows.push({
      fixture,
      engine,
      'CPU ms / render (median)': format(median(samples.map(({ cpuMs }) => cpuMs))),
      'Baseline MiB (median)': format(median(samples.map(({ baselineMiB }) => baselineMiB))),
      'Peak MiB (median)': format(median(samples.map(({ peakMiB }) => peakMiB))),
      'Peak MiB (max)': format(Math.max(...samples.map(({ peakMiB }) => peakMiB))),
    })
  }
}

console.log(`${viewport.width} × ${viewport.height}, 5 samples per mode after 2 warmups`)
console.table(rows)
