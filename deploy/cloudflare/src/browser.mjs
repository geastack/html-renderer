import { spawn } from 'node:child_process'
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

async function openChrome() {
  const profile = await mkdtemp(join(tmpdir(), 'chrome-'))
  const child = spawn(
    executablePath,
    [
      ...args,
      ...(fullChrome ? ['--headless=new'] : []),
      '--remote-debugging-pipe',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] },
  )
  let diagnostics = ''
  let incoming = ''
  let id = 0
  const pending = new Map()

  child.stderr.on('data', (chunk) => {
    diagnostics = (diagnostics + chunk).slice(-8192)
  })

  child.stdio[4].setEncoding('utf8').on('data', (chunk) => {
    const messages = (incoming + chunk).split('\0')

    incoming = messages.pop()

    for (const line of messages) {
      const message = JSON.parse(line)
      const entry = pending.get(message.id)

      if (!entry) {
        continue
      }

      clearTimeout(entry.timeout)
      pending.delete(message.id)
      if (message.error) {
        entry.reject(new Error(message.error.message))
      } else {
        entry.resolve(message.result)
      }
    }
  })

  const disconnected = (error) => {
    for (const { reject, timeout } of pending.values()) {
      clearTimeout(timeout)
      reject(error)
    }

    pending.clear()
  }

  child.once('error', disconnected)
  child.once('exit', (code, signal) => {
    disconnected(new Error(`Chrome exited (${signal ?? code}): ${diagnostics}`))
  })
  child.stdio[3].on('error', disconnected)

  const send = (method, params, sessionId) =>
    new Promise((resolve, reject) => {
      const request = ++id
      const timeout = setTimeout(() => {
        pending.delete(request)
        reject(new Error(`Chrome DevTools timed out during ${method}: ${diagnostics}`))
      }, 20_000)

      pending.set(request, { resolve, reject, timeout })
      child.stdio[3].write(JSON.stringify({ id: request, method, params, sessionId }) + '\0')
    })

  try {
    const { targetInfos } = await send('Target.getTargets')
    const targetId = targetInfos.find((target) => target.type === 'page')?.targetId
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
    const page = (method, params) => send(method, params, sessionId)

    await page('Page.enable')
    await page('Emulation.setDeviceMetricsOverride', {
      ...viewport,
      mobile: false,
      deviceScaleFactor: 1,
    })

    return {
      async mount(url) {
        const navigation = await page('Page.navigate', { url })

        if (navigation.errorText) {
          throw new Error(navigation.errorText)
        }

        for (let attempt = 0; attempt < 200; attempt++) {
          const { result } = await page('Runtime.evaluate', {
            expression: `document.URL === ${JSON.stringify(url)} && document.readyState === 'complete' && (${ready})`,
            awaitPromise: true,
            returnByValue: true,
          })

          if (result?.value === true) {
            return
          }

          await new Promise((resolve) => setTimeout(resolve, 20))
        }

        throw new Error('Chrome page did not finish loading')
      },
      async capture() {
        const { data } = await page('Page.captureScreenshot', { format: 'png', fromSurface: true })

        return Buffer.from(data, 'base64')
      },
    }
  } catch (error) {
    child.kill('SIGKILL')
    await rm(profile, { recursive: true, force: true, maxRetries: 2 })
    throw error
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
    let pending
    const sampler = setInterval(() => {
      pending ??= memory()
        .then((bytes) => {
          peak = Math.max(peak, bytes)
        })
        .finally(() => {
          pending = undefined
        })
    }, 5)

    let png

    try {
      browser ??= await (selected === 'playwright' ? openPlaywright() : openChrome())
      if (mounted !== fixture || remount) {
        await browser.mount(
          new URL(`../../../fixtures/${fixture}/${fixture}.html`, import.meta.url).href,
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

    peak = Math.max(peak, await memory())
    response
      .writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': png.length,
        'x-bench-container-ms': String(performance.now() - started),
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
