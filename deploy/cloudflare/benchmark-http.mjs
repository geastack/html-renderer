import { randomUUID, createHash } from 'node:crypto'
import { Agent, request } from 'node:https'
import { setTimeout as delay } from 'node:timers/promises'

const native = process.env.BENCHMARK_NATIVE_URL
const browser = process.env.BENCHMARK_BROWSER_URL
const lite = process.env.BENCHMARK_LITE_URL
const token = process.env.BENCHMARK_TOKEN

if (!token || !native || (!lite && !browser)) {
  throw new Error(
    'Set BENCHMARK_TOKEN and BENCHMARK_NATIVE_URL, plus BENCHMARK_LITE_URL or BENCHMARK_BROWSER_URL',
  )
}

const engines = lite
  ? [
      { name: 'Gea Lite', origin: lite, prefix: '', cached: true },
      { name: 'Gea Basic', origin: native, prefix: '', cached: true },
    ]
  : [
      { name: 'Gea', origin: native, prefix: '', cached: true },
      { name: 'Playwright', origin: browser, prefix: '/playwright' },
      { name: 'Chrome', origin: browser, prefix: '/chrome' },
    ]
const agent = new Agent({ keepAlive: true, maxSockets: 3 })

const p = (xs, q) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * q) - 1]
const stats = (rows, k, digits = 1) =>
  [0.5, 0.95]
    .map((q) =>
      p(
        rows.map((r) => r[k]),
        q,
      ).toFixed(digits),
    )
    .join(' / ')

function get(engine, path, id, method = 'GET') {
  return new Promise((resolve, reject) => {
    const start = performance.now()
    const req = request(
      new URL(path, engine.origin),
      {
        agent,
        method,
        headers: { Authorization: 'Bearer ' + token, 'x-gea-benchmark-instance': id },
      },
      (res) => {
        const headers = performance.now()
        const chunks = []

        res.on('data', (chunk) => chunks.push(chunk))
        res.on('error', reject)
        res.on('end', () => {
          const end = performance.now()
          const png = Buffer.concat(chunks)

          if (res.statusCode !== (method === 'GET' ? 200 : 204)) {
            const body = png.toString()
            const err = new Error(
              engine.name + ' ' + path + ' HTTP ' + res.statusCode + ': ' + body.slice(0, 300),
            )

            err.capacity =
              /Maximum number of running container instances exceeded|no Container instance available/i.test(
                body,
              )

            return reject(err)
          }

          if (method !== 'GET') {
            return resolve()
          }

          const values = String(res.headers['x-gea-capture'] ?? '')
            .split(',')
            .map(Number)
          const [capture, cpu, ramBefore, ramPeak, startup] = values

          if (
            values.length !== 5 ||
            !(capture > 0 && cpu >= 0 && ramPeak >= ramBefore && ramBefore > 0) ||
            png.length < 24 ||
            png.toString('hex', 0, 8) !== '89504e470d0a1a0a' ||
            png.readUInt32BE(16) !== 1920 ||
            png.readUInt32BE(20) !== 1080
          ) {
            return reject(new Error(engine.name + ' invalid capture or PNG'))
          }

          const [worker, durable, container] = ['worker', 'do', 'container'].map((name) => {
            const value = res.headers['x-bench-' + name + '-ms']

            return value === undefined ? NaN : Number(value)
          })

          if (![worker, durable, container].every((x) => Number.isFinite(x) && x >= 0)) {
            return reject(new Error(engine.name + ' missing hop timings'))
          }

          const ttfb = headers - start

          resolve({
            capture: capture / 1000,
            cpu: cpu / 1000,
            startup: startup / 1000,
            ramBefore: ramBefore / 1048576,
            ramPeak: ramPeak / 1048576,
            ttfb,
            worker,
            durable,
            container,
            ingress: ttfb - worker,
            workerToDO: worker - durable,
            doToContainer: durable - container,
            residual: ttfb - capture / 1000,
            download: end - headers,
            total: end - start,
            bytes: png.length,
            hash: createHash('sha256').update(png).digest('hex'),
            reused: req.reusedSocket,
            colo: String(res.headers['cf-ray']).split('-').at(-1),
          })
        })
      },
    )

    req.setTimeout(120000, () => req.destroy(new Error('Request timed out')))
    req.on('error', reject)
    req.end()
  })
}

async function fetchSample(engine, path, id) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await get(engine, path, id)
    } catch (e) {
      if (!e.capacity || attempt >= 8) {
        throw e
      }

      await delay(4000)
    }
  }
}

const coldOnly = process.argv.includes('--cold-only')

try {
  for (const fixture of ['card', 'promo']) {
    const phases = coldOnly ? ['Cold start'] : ['Cold start', 'Reuse', 'Remount']
    const samples = new Map(
      engines.map((e) => [e.name, Object.fromEntries(phases.map((phase) => [phase, []]))]),
    )
    const hashes = new Map()
    const active = new Map()

    function add(engine, phase, row) {
      if ((phase === 'Cold start') !== row.startup >= 0) {
        throw new Error(engine.name + ': unexpected process state')
      }

      if (!hashes.has(engine.name)) {
        hashes.set(engine.name, row.hash)
      }

      if (hashes.get(engine.name) !== row.hash) {
        throw new Error(engine.name + ': PNG changed between modes')
      }

      samples.get(engine.name)[phase].push(row)
    }

    try {
      for (let i = 0; i < 3; i++) {
        for (const engine of [...engines.slice(i), ...engines.slice(0, i)]) {
          if (active.has(engine.name)) {
            await get(engine, '/__benchmark/reset', active.get(engine.name), 'POST')
          }

          const id = randomUUID()

          active.set(engine.name, id)
          // Reset on a fresh ID primes TLS without starting this container.
          await get(engine, '/__benchmark/reset', id, 'POST')
          const row = await fetchSample(engine, engine.prefix + '/' + fixture, id)

          add(engine, 'Cold start', row)
          console.error(fixture, engine.name, 'cold', i + 1)
        }
      }

      if (!coldOnly) {
        for (const engine of engines) {
          for (const suffix of ['', '', '/cold', '']) {
            await fetchSample(
              engine,
              engine.prefix + '/' + fixture + suffix,
              active.get(engine.name),
            )
          }
        }

        for (let i = 0; i < 40; i++) {
          const phase = i % 2 ? 'Remount' : 'Reuse'
          const offset = Math.floor(i / 2) % engines.length

          for (const engine of [...engines.slice(offset), ...engines.slice(0, offset)]) {
            const suffix = phase === 'Remount' ? '/cold' : ''
            const row = await fetchSample(
              engine,
              engine.prefix + '/' + fixture + suffix,
              active.get(engine.name),
            )

            add(engine, phase, row)
          }

          await delay(10)
        }
      }

      if (lite && new Set(hashes.values()).size !== 1) {
        throw new Error(fixture + ': Lite and Basic produced different PNGs')
      }

      for (const phase of phases) {
        for (const engine of engines) {
          const rows = samples.get(engine.name)[phase]

          if (
            engine.cached &&
            phase === 'Reuse' &&
            p(
              rows.map((row) => row.capture),
              0.5,
            ) >= 5
          ) {
            throw new Error(engine.name + ': Gea cache inactive')
          }

          const record = {
            fixture,
            mode: phase,
            engine: engine.name,
            n: rows.length,
            edge: [...new Set(rows.map((r) => r.colo))].join(','),
            connectionsReused: rows.filter((r) => r.reused).length,
            pngBytes: rows[0].bytes,
            capture: stats(rows, 'capture', 3),
            otherBeforeHeaders: stats(rows, 'residual'),
            download: stats(rows, 'download'),
            http: stats(rows, 'total'),
            ttfb: stats(rows, 'ttfb'),
            ingress: stats(rows, 'ingress'),
            workerToDO: stats(rows, 'workerToDO'),
            doToContainer: stats(rows, 'doToContainer'),
            container: stats(rows, 'container', 3),
            cpu: stats(rows, 'cpu'),
            ramBefore: p(
              rows.map((r) => r.ramBefore),
              0.5,
            ).toFixed(1),
            ramPeak:
              p(
                rows.map((r) => r.ramPeak),
                0.5,
              ).toFixed(1) +
              ' / ' +
              Math.max(...rows.map((r) => r.ramPeak)).toFixed(1),
          }

          console.log(JSON.stringify(record))
        }
      }
    } finally {
      await Promise.allSettled(
        engines
          .filter((e) => active.has(e.name))
          .map((e) => get(e, '/__benchmark/reset', active.get(e.name), 'POST')),
      )
    }
  }
} finally {
  agent.destroy()
}
