import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { chromium } from 'playwright'

import { openRenderer } from '../../../lib/worker.mjs'
import { localExecutable } from '../../../scripts/local-executable.mjs'
import { openChrome } from './src/chrome.mjs'

const exec = promisify(execFile)
const root = fileURLToPath(new URL('../../../', import.meta.url))
const viewport = { width: 1920, height: 1080 }
const renderer = process.env.GEA_RENDERER ?? localExecutable(root)
const chrome =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const output = path.join(root, 'dist', 'benchmark-local.png')
const args = [
  '--hide-scrollbars',
  '--disable-background-networking',
  '--disable-gpu',
  '--use-mock-keychain',
]
const coldSamples = Number(process.env.BENCHMARK_COLD_SAMPLES ?? 5)
const warmSamples = Number(process.env.BENCHMARK_WARM_SAMPLES ?? 20)

assert(process.platform === 'darwin', 'This benchmark uses macOS process counters')
assert(Number.isInteger(coldSamples) && coldSamples > 0)
assert(Number.isInteger(warmSamples) && warmSamples > 0)

async function snapshot() {
  const { stdout } = await exec('/bin/ps', ['-axo', 'pid=,ppid=,rss=,time=,comm='])
  const rows = stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => line.trim().split(/\s+/, 5))
  const descendants = new Set([process.pid])

  for (let size = 0; size !== descendants.size;) {
    size = descendants.size
    for (const [pid, parent, , , command] of rows) {
      if (descendants.has(Number(parent)) && path.basename(command) !== 'ps') {
        descendants.add(Number(pid))
      }
    }
  }

  return rows.flatMap(([pid, , rss, elapsed]) => {
    if (Number(pid) === process.pid || !descendants.has(Number(pid))) {
      return []
    }

    const cpu = elapsed.split(':').reduce((total, unit) => total * 60 + Number(unit), 0)

    return [{ pid, rss: Number(rss), cpu }]
  })
}

async function measure(run) {
  const before = new Map((await snapshot()).map(({ pid, cpu }) => [pid, cpu]))
  const last = new Map()
  let peak = 0
  let stopped = false
  const record = async () => {
    const rows = await snapshot()

    peak = Math.max(
      peak,
      rows.reduce((sum, row) => sum + row.rss, 0),
    )
    for (const { pid, cpu } of rows) {
      last.set(pid, cpu)
    }
  }

  const monitor = (async () => {
    while (!stopped) {
      await delay(25)
      if (!stopped) {
        await record()
      }
    }
  })()
  const start = performance.now()
  let elapsed

  try {
    await run()
    elapsed = performance.now() - start
    await record()
  } finally {
    stopped = true
    await monitor
  }

  const cpu = [...last].reduce((sum, [pid, total]) => sum + total - (before.get(pid) ?? 0), 0)
  const png = await readFile(output)

  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  assert.equal(png.readUInt32BE(16), viewport.width)
  assert.equal(png.readUInt32BE(20), viewport.height)
  assert(peak > 0, 'No renderer processes were sampled')

  return {
    elapsed,
    cpu: cpu * 1000,
    rss: peak / 1024,
    hash: createHash('sha256').update(png).digest('hex'),
  }
}

async function openEngine(engine, input) {
  if (engine === 'Gea') {
    const session = openRenderer(renderer)

    return {
      capture: () => session.capture({ input, out: output, ...viewport }),
      close: () => session.close(),
    }
  }

  const url = pathToFileURL(input).href

  if (engine === 'Chrome') {
    const profile = await mkdtemp(path.join(root, 'dist', 'local-chrome-profile-'))
    const browser = await openChrome({
      executablePath: chrome,
      args,
      profile,
      viewport,
      headless: true,
    })
    let mounts = 0

    return {
      async capture() {
        await browser.mount(url + '?benchmarkMount=' + ++mounts)

        await writeFile(output, await browser.capture())
      },
      close: () => browser.close(),
    }
  }

  const browser = await chromium.launch({ executablePath: chrome, args })

  try {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 })

    return {
      async capture() {
        await page.goto(url, { waitUntil: 'load' })
        await page
          .locator('html')
          .evaluate((element) => element.ownerDocument.fonts.ready.then(() => true))

        await page.screenshot({ path: output })
      },
      close: () => browser.close(),
    }
  } catch (error) {
    await browser.close()
    throw error
  }
}

const percentile = (rows, field, p) =>
  rows.map((row) => row[field]).sort((a, b) => a - b)[Math.ceil(rows.length * p) - 1]

for (const fixture of ['card', 'promo']) {
  const input = path.join(root, 'fixtures', fixture, fixture + '.html')

  for (const engine of ['Gea', 'Chrome', 'Playwright']) {
    const cold = []
    const remount = []

    for (let i = 0; i < coldSamples; i++) {
      let session

      try {
        cold.push(
          await measure(async () => {
            session = await openEngine(engine, input)
            await session.capture()
          }),
        )
      } finally {
        await session?.close()
      }
    }

    const session = await openEngine(engine, input)

    try {
      await session.capture()
      for (let i = 0; i < warmSamples; i++) {
        remount.push(await measure(() => session.capture()))
      }
    } finally {
      await session.close()
    }

    for (const [mode, rows] of [
      ['Cold start', cold],
      ['Remount', remount],
    ]) {
      console.log(
        JSON.stringify({
          fixture,
          engine,
          mode,
          n: rows.length,
          wallMedianMs: percentile(rows, 'elapsed', 0.5),
          wallP95Ms: percentile(rows, 'elapsed', 0.95),
          cpuMedianMs: percentile(rows, 'cpu', 0.5),
          peakRssMedianMiB: percentile(rows, 'rss', 0.5),
          hashes: [...new Set(rows.map(({ hash }) => hash))],
        }),
      )
    }
  }
}
