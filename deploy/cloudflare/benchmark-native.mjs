import { createHash, randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'

const [base, coldCount = '5', warmCount = '20', engine = 'gea'] = process.argv.slice(2)
const token = process.env.BENCHMARK_TOKEN

if (
  !base ||
  !token ||
  !['gea', 'playwright', 'chrome'].includes(engine) ||
  ![coldCount, warmCount].map(Number).every((count) => Number.isSafeInteger(count) && count > 0)
) {
  throw new Error(
    'Set BENCHMARK_TOKEN and pass the Worker URL [cold samples] [warm samples] [engine]',
  )
}

async function request(path, instance, method = 'GET') {
  const response = await fetch(new URL(path, base), {
    method,
    headers: { Authorization: `Bearer ${token}`, 'x-gea-benchmark-instance': instance },
    signal: AbortSignal.timeout(120_000),
  })

  if (!response.ok) {
    const body = await response.text()
    const error = new Error(`${method} ${path}: HTTP ${response.status}: ${body.slice(0, 300)}`)

    if (
      (response.status === 500 &&
        body.includes('Maximum number of running container instances exceeded')) ||
      (response.status === 503 && body.includes('no Container instance available'))
    ) {
      error.code = 'CONTAINER_CAPACITY'
    }

    throw error
  }

  return response
}

async function measure(path, instance, cold) {
  for (let attempt = 0; ; attempt++) {
    const start = performance.now()

    try {
      const response = await request(path, instance)
      const png = Buffer.from(await response.arrayBuffer())

      return { response, png, http: performance.now() - start }
    } catch (error) {
      if (!cold || error.code !== 'CONTAINER_CAPACITY' || attempt >= 8) {
        throw error
      }

      await setTimeout(5000)
    }
  }
}

const rows = []

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b)

  return sorted[Math.ceil(sorted.length * fraction) - 1]
}

const pair = (values, digits = 1) =>
  [percentile(values, 0.5), percentile(values, 0.95)]
    .map((value) => value.toFixed(digits))
    .join(' / ')
const mib = 1024 ** 2

for (const fixture of ['card', 'promo']) {
  let expectedHash
  let instance

  for (const [mode, suffix, count] of [
    ['Cold start', '', Number(coldCount)],
    ['Mounted page reused', '', Number(warmCount)],
    ['Page remounted', '/cold', Number(warmCount)],
  ]) {
    const cold = mode === 'Cold start'
    const path = `${engine === 'gea' ? '' : '/' + engine}/${fixture}${suffix}`
    const samples = []

    if (!cold) {
      await (await request(path, instance)).arrayBuffer()
    }

    for (let index = 0; index < count; index++) {
      if (cold) {
        if (instance) {
          await request('/__benchmark/reset', instance, 'POST')
        }

        instance = randomUUID()
      }

      const { response, png, http } = await measure(path, instance, cold)
      const counters = (response.headers.get('x-gea-capture') ?? '').split(',').map(Number)
      const [capture, cpu, baseline, peak, startupCpu] = counters
      const hash = createHash('sha256').update(png).digest('hex')

      expectedHash ??= hash
      if (
        png.toString('hex', 0, 8) !== '89504e470d0a1a0a' ||
        png.readUInt32BE(16) !== 1920 ||
        png.readUInt32BE(20) !== 1080 ||
        hash !== expectedHash ||
        counters.length !== 5 ||
        ![capture, baseline, peak].every((value) => Number.isFinite(value) && value > 0) ||
        !Number.isFinite(cpu) ||
        cpu < 0 ||
        (cold ? !(startupCpu >= cpu) : startupCpu !== -1)
      ) {
        throw new Error(`${fixture} ${mode}: invalid PNG or counters ${counters}`)
      }

      samples.push({ http, capture, cpu, baseline, peak })

      if (cold) {
        console.log(`${fixture}: cold start ${index + 1}/${count}`)
      }
    }

    rows.push({
      fixture,
      mode,
      n: count,
      'HTTP ms p50 / p95': pair(samples.map((sample) => sample.http)),
      'Capture ms p50 / p95': pair(
        samples.map((sample) => sample.capture / 1000),
        3,
      ),
      'CPU ms p50 / p95': pair(samples.map((sample) => sample.cpu / 1000)),
      'RAM before MiB p50': percentile(
        samples.map((sample) => sample.baseline / mib),
        0.5,
      ).toFixed(1),
      'RAM peak MiB p50 / max': [
        percentile(
          samples.map((sample) => sample.peak / mib),
          0.5,
        ),
        Math.max(...samples.map((sample) => sample.peak / mib)),
      ]
        .map((value) => value.toFixed(1))
        .join(' / '),
    })
    console.log(`${fixture}: completed ${count} ${mode.toLowerCase()} samples`)
  }

  await request('/__benchmark/reset', instance, 'POST')
}

console.table(rows)
