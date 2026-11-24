import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const { openRenderer } = await import(
  process.env.GEA_RENDERER ? '../../../lib/worker.mjs' : '@geastack/html-renderer'
)
const viewport = { width: 1920, height: 1080 }
const fixtures = new Map(
  ['card', 'promo'].map((name) => [
    name,
    fileURLToPath(new URL(`../../../fixtures/${name}/${name}.html`, import.meta.url)),
  ]),
)
const modes = new Set(['gea-cold', 'gea-warm', 'playwright-cold', 'playwright-warm', 'chrome-cold'])
const chrome = chromium.executablePath()
const browserArgs = [
  '--hide-scrollbars',
  '--disable-background-networking',
  '--disable-gpu',
  '--use-mock-keychain',
  '--no-sandbox',
]
let renderer = openRenderer(process.env.GEA_RENDERER)
let profileEngine
let warmBrowser
let warmPage
let warmInput
let busy = false

function stopChrome(child, group) {
  if (!child.pid) {
    return
  }

  try {
    if (group) {
      process.kill(-child.pid, 'SIGKILL')
    } else {
      child.kill('SIGKILL')
    }
  } catch (error) {
    if (error.code !== 'ESRCH') {
      throw error
    }
  }
}

async function captureChrome(url, out, directory) {
  const group = process.platform !== 'win32'
  const child = spawn(
    chrome,
    [
      ...browserArgs,
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--force-device-scale-factor=1',
      `--user-data-dir=${join(directory, 'chrome')}`,
      `--window-size=${viewport.width},${viewport.height}`,
      `--screenshot=${out}`,
      url,
    ],
    { detached: group, stdio: ['ignore', 'ignore', 'pipe'] },
  )
  const exited = new Promise((resolve) => {
    child.once('exit', resolve)
    child.once('error', resolve)
  })
  let timer
  let diagnostics = ''

  try {
    await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Chrome timed out before writing its PNG')), 30_000)
      child.once('error', reject)
      child.once('close', (code) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`Chrome exited with status ${code}: ${diagnostics}`))
        }
      })
      child.stderr.setEncoding('utf8').on('data', (chunk) => {
        diagnostics = (diagnostics + chunk).slice(-8192)
        // Chrome can write the complete PNG before its platform teardown stalls.
        if (diagnostics.includes(`bytes written to file ${out}`)) {
          resolve()
        }
      })
    })
  } finally {
    clearTimeout(timer)
    stopChrome(child, group)
    await exited
  }
}

async function capture(engine, input, out, directory) {
  if (engine === 'gea-warm') {
    await renderer.capture({ input, out, ...viewport, reusePage: true })

    return
  }

  if (engine === 'gea-cold') {
    const oneShot = openRenderer(process.env.GEA_RENDERER)

    try {
      await oneShot.capture({ input, out, ...viewport })
    } finally {
      await oneShot.close()
    }

    return
  }

  const url = pathToFileURL(input).href

  if (engine === 'chrome-cold') {
    await captureChrome(url, out, directory)

    return
  }

  const launch = () => chromium.launch({ executablePath: chrome, args: browserArgs })
  const openPage = (browser) => browser.newPage({ viewport, deviceScaleFactor: 1 })
  const loadPage = async (page) => {
    await page.goto(url, { waitUntil: 'load' })
    await page
      .locator('html')
      .evaluate((element) => element.ownerDocument.fonts.ready.then(() => undefined))
  }

  if (engine === 'playwright-warm') {
    if (!warmBrowser?.isConnected()) {
      warmBrowser = await launch()
      warmPage = undefined
      warmInput = undefined
    }

    warmPage ??= await openPage(warmBrowser)
    if (warmInput !== input) {
      await loadPage(warmPage)
      warmInput = input
    }

    await warmPage.screenshot({ path: out })

    return
  }

  const browser = await launch()

  try {
    const page = await openPage(browser)

    await loadPage(page)
    await page.screenshot({ path: out })
  } finally {
    await browser.close()
  }
}

const cgroup = '/sys/fs/cgroup'

async function counters(file) {
  const contents = await readFile(join(cgroup, file), 'utf8')

  return Object.fromEntries(
    contents
      .trim()
      .split('\n')
      .map((line) => {
        const [key, value] = line.split(/\s+/)

        return [key, Number(value)]
      }),
  )
}

async function anonymousMemory() {
  const { anon, shmem } = await counters('memory.stat')

  return anon + shmem
}

async function profileCapture(engine, input, out, directory) {
  if (profileEngine !== engine) {
    await renderer.close()
    renderer = openRenderer(process.env.GEA_RENDERER)
    await warmBrowser?.close()
    warmBrowser = undefined
    warmPage = undefined
    warmInput = undefined
    profileEngine = engine
  }

  const baseline = await anonymousMemory()
  const cpuBefore = (await counters('cpu.stat')).usage_usec
  let peak = baseline
  let pending

  const timer = setInterval(() => {
    pending ??= anonymousMemory()
      .then(
        (bytes) => {
          peak = Math.max(peak, bytes)
        },
        () => {},
      )
      .finally(() => {
        pending = undefined
      })
  }, 10)

  try {
    await capture(engine, input, out, directory)
  } finally {
    clearInterval(timer)
    await pending
  }

  const cpuAfter = (await counters('cpu.stat')).usage_usec

  peak = Math.max(peak, await anonymousMemory())

  return {
    cpuMs: (cpuAfter - cpuBefore) / 1000,
    baselineMiB: baseline / 1048576,
    peakMiB: peak / 1048576,
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost')

  if (request.method !== 'GET') {
    response.writeHead(405, { Allow: 'GET' }).end()

    return
  }

  if (url.pathname === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({
        viewport,
        fixtures: [...fixtures.keys()],
        modes: [...modes],
        platform: process.platform,
        arch: process.arch,
      }),
    )

    return
  }

  if (url.pathname !== '/render') {
    response.writeHead(404).end()

    return
  }

  const input = fixtures.get(url.searchParams.get('fixture'))
  const engine = url.searchParams.get('engine')

  if (!input || !modes.has(engine)) {
    response.writeHead(400).end('Choose a fixture and engine from /health')

    return
  }

  if (busy) {
    response.writeHead(429).end('A render is already in progress')

    return
  }

  busy = true
  let directory

  try {
    directory = await mkdtemp(join(tmpdir(), 'gea-render-'))
    const out = join(directory, 'render.png')
    const started = performance.now()

    const profile =
      url.searchParams.get('profile') === '1'
        ? await profileCapture(engine, input, out, directory)
        : await capture(engine, input, out, directory)
    const png = await readFile(out)
    const elapsed = performance.now() - started

    if (png.readUInt32BE(16) !== viewport.width || png.readUInt32BE(20) !== viewport.height) {
      throw new Error('Unexpected PNG dimensions')
    }

    await rm(directory, { recursive: true, force: true, maxRetries: 2 })
    directory = undefined
    response
      .writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
        ...(profile ? { 'X-Render-Resources': JSON.stringify(profile) } : {}),
        'Server-Timing': `render;dur=${elapsed.toFixed(3)}`,
      })
      .end(png)
  } catch (error) {
    console.error(error)
    response
      .writeHead(500)
      .end(url.searchParams.get('profile') === '1' ? error.message : 'Render failed')
  } finally {
    try {
      if (directory) {
        await rm(directory, { recursive: true, force: true, maxRetries: 2 })
      }
    } finally {
      busy = false
    }
  }
})

server.listen(Number(process.env.PORT ?? 8080), '0.0.0.0')
