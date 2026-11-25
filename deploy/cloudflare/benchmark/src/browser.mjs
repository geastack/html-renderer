import { readFile, readdir, mkdtemp } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openChrome } from './chrome.mjs'

const viewport = { width: 1920, height: 1080 }
const fullChrome = process.env.GEA_BENCHMARK_FULL_CHROME === '1'
const browserRoot = process.env.PLAYWRIGHT_BROWSERS_PATH
const browserName = (await readdir(browserRoot)).find((name) =>
  name.startsWith(fullChrome ? 'chromium-' : 'chromium_headless_shell-'),
)
const executablePath = join(
  browserRoot,
  browserName,
  fullChrome ? 'chrome-linux64/chrome' : 'chrome-headless-shell-linux64/chrome-headless-shell',
)
const args = [
  '--hide-scrollbars',
  '--disable-background-networking',
  '--disable-gpu',
  '--no-sandbox',
]

if (!fullChrome) {
  args.push(
    '--no-zygote',
    '--single-process',
    '--disable-dev-shm-usage',
    '--disable-crash-reporter',
    '--disable-breakpad',
    '--disable-software-rasterizer',
  )
}

const ready = 'document.fonts.ready.then(() => true)'

async function openPlaywright() {
  const { chromium } = await import('playwright')
  let page

  if (fullChrome) {
    const browser = await chromium.launch({ executablePath, args })

    page = await browser.newPage({ viewport, deviceScaleFactor: 1 })
  } else {
    const profile = await mkdtemp(join(tmpdir(), 'playwright-'))
    const context = await chromium.launchPersistentContext(profile, {
      executablePath,
      args,
      viewport,
      deviceScaleFactor: 1,
      timeout: 30_000,
    })

    page = context.pages()[0] ?? (await context.newPage())
  }

  page.setDefaultTimeout(15_000)

  return {
    async mount(url) {
      await page.goto(url, { waitUntil: 'load' })
      await page.evaluate(ready)
    },
    capture: () => page.screenshot(),
  }
}

async function counters(file, keys) {
  const text = await readFile('/sys/fs/cgroup/' + file, 'utf8')
  const values = new Map(
    text
      .trim()
      .split('\n')
      .map((line) => line.split(/\s+/)),
  )

  return keys.reduce((total, key) => total + Number(values.get(key)), 0)
}

const memory = () => counters('memory.stat', ['anon', 'shmem'])
const totalMemory = async () => Number(await readFile('/sys/fs/cgroup/memory.current', 'utf8'))
const cpu = () => counters('cpu.stat', ['usage_usec'])
let browser
let mounted
let engine
let busy = false
let first = true

createServer(async (request, response) => {
  const started = performance.now()
  const url = new URL(request.url, 'http://localhost')

  if (url.pathname === '/health') {
    response.end('ok')

    return
  }

  const match = /^\/(playwright|chrome)\/(card|promo)(\/cold)?$/.exec(url.pathname)

  if (request.method !== 'GET' || !match) {
    response.writeHead(404).end()

    return
  }

  const [, selected, fixture, remount] = match

  if (busy || (engine && engine !== selected)) {
    response.writeHead(409).end('Use one browser engine per benchmark container')

    return
  }

  busy = true
  engine = selected
  try {
    const start = performance.now()
    const before = await cpu()
    const baseline = await memory()
    let peak = baseline
    let totalPeak = await totalMemory()

    async function sampleMemory() {
      const [anonymous, total] = await Promise.all([memory(), totalMemory()])

      peak = Math.max(peak, anonymous)
      totalPeak = Math.max(totalPeak, total)
    }

    let pending
    const sampler = setInterval(() => {
      pending ??= sampleMemory().finally(() => {
        pending = undefined
      })
    }, 5)

    let png

    try {
      browser ??=
        selected === 'playwright'
          ? await openPlaywright()
          : await openChrome({
              executablePath,
              args,
              profile: await mkdtemp(join(tmpdir(), 'chrome-')),
              viewport,
              headless: fullChrome,
            })
      if (mounted !== fixture || remount) {
        await browser.mount(
          new URL(`../../../../fixtures/${fixture}/${fixture}.html`, import.meta.url).href,
        )
        mounted = fixture
      }

      png = await browser.capture()
    } finally {
      clearInterval(sampler)
      await pending
    }

    const elapsed = Math.round((performance.now() - start) * 1000)
    const after = await cpu()

    await sampleMemory()
    response
      .writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': png.length,
        'x-bench-container-ms': String(performance.now() - started),
        'x-gea-memory-current-peak': String(totalPeak),
        'X-Gea-Capture': [elapsed, after - before, baseline, peak, first ? after : -1].join(','),
      })
      .end(png)
    first = false
  } catch (error) {
    const events = await readFile('/sys/fs/cgroup/memory.events', 'utf8').catch(() => '')

    console.error(error, events)
    response.writeHead(500).end(events + '\n' + error.message)
  } finally {
    busy = false
  }
}).listen(8080, '0.0.0.0')
