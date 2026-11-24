import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openChrome } from './chrome.mjs'

const child = spawn('./gea-html-renderer', ['--gea-prerender-http'], { stdio: 'inherit' })

child.once('exit', (code) => process.exit(code ?? 1))
child.once('error', (error) => {
  console.error(error)
  process.exit(1)
})
process.once('SIGTERM', () => child.kill())

const chromeRoot = process.env.PLAYWRIGHT_BROWSERS_PATH
const release = (await readdir(chromeRoot)).find((name) => name.startsWith('chromium-'))
const executablePath = join(chromeRoot, release, 'chrome-linux64/chrome')
const viewport = { width: 1920, height: 1080 }
const native = 'http://127.0.0.1:8080'

let browser
let mounting = 0
let busy = false

async function cpu() {
  const stat = await readFile('/sys/fs/cgroup/cpu.stat', 'utf8')

  return Object.fromEntries(
    stat
      .trim()
      .split('\n')
      .map((line) => {
        const [name, value] = line.split(/\s+/)

        return [name, Number(value)]
      }),
  )
}

async function capture(engine, fixture) {
  const before = await cpu()
  const start = performance.now()
  let png
  let nativeCaptureMs

  if (engine === 'Gea') {
    const response = await fetch(`${native}/${fixture}/cold`)

    if (!response.ok) {
      throw new Error(await response.text())
    }

    png = Buffer.from(await response.arrayBuffer())
    nativeCaptureMs = Number(response.headers.get('x-gea-capture').split(',')[0]) / 1000
  } else {
    const page = new URL(`../../../../fixtures/${fixture}/${fixture}.html`, import.meta.url)

    page.searchParams.set('mount', String(++mounting))
    await browser.mount(page.href)
    png = await browser.capture()
  }

  const elapsed = performance.now() - start
  const after = await cpu()

  if (png.readUInt32BE(16) !== viewport.width || png.readUInt32BE(20) !== viewport.height) {
    throw new Error('Invalid PNG dimensions')
  }

  return {
    engine,
    elapsed,
    nativeCaptureMs,
    cpuMs: (after.usage_usec - before.usage_usec) / 1000,
    throttledMs: (after.throttled_usec - before.throttled_usec) / 1000,
    throttledPeriods: after.nr_throttled - before.nr_throttled,
    sha256: createHash('sha256').update(png).digest('hex'),
  }
}

createServer(async (request, response) => {
  if (request.url === '/health') {
    const ready = await fetch(native + '/health')
      .then((result) => result.ok)
      .catch(() => false)

    response.writeHead(ready ? 200 : 503).end()

    return
  }

  const match = /^\/paired\/(card|promo)$/.exec(request.url)

  if (request.method !== 'GET' || !match || busy) {
    response.writeHead(busy ? 409 : 404).end()

    return
  }

  busy = true
  try {
    browser ??= await openChrome({
      executablePath,
      args: [
        '--hide-scrollbars',
        '--disable-background-networking',
        '--disable-gpu',
        '--no-sandbox',
      ],
      profile: await mkdtemp(join(tmpdir(), 'paired-chrome-')),
      viewport,
      headless: true,
    })

    const fixture = match[1]
    const samples = []

    for (let i = -2; i < 12; i++) {
      for (const engine of i % 2 === 0 ? ['Gea', 'Chrome'] : ['Chrome', 'Gea']) {
        const sample = await capture(engine, fixture)

        if (i >= 0) {
          samples.push({ pair: i, ...sample })
        }
      }
    }

    const quota = (await readFile('/sys/fs/cgroup/cpu.max', 'utf8')).trim()

    response
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ fixture, quota, release, samples }))
  } catch (error) {
    console.error(error)
    response.writeHead(500).end(error.message)
  } finally {
    busy = false
  }
}).listen(8081, '0.0.0.0')
