import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'
import { PNG } from 'pngjs'
import { templateCases, withRenderedPage } from '../fixtures/shared/templates.mjs'
import { openRenderer } from '../lib/worker.mjs'
import { localExecutable } from './local-executable.mjs'
import { writeReport } from './visual-report.mjs'

const { values, positionals: selected } = parseArgs({
  allowPositionals: true,
  options: { strict: { type: 'boolean' } },
})
const root = fileURLToPath(new URL('../', import.meta.url))
const fixtures = path.join(root, 'fixtures')
const output = path.join(root, 'dist', 'visual-diff')
const staticCases = {
  card: { id: 'card', width: 480, height: 220 },
  promo: { id: 'promo', width: 1200, height: 630 },
}
const names = readdirSync(fixtures, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== 'shared')
  .map((entry) => entry.name)
  .sort()

for (const name of selected) {
  if (!names.includes(name)) {
    throw new Error(`Unknown fixture: ${name}`)
  }
}

function casesFor(name) {
  const directory = path.join(fixtures, name)
  const page = staticCases[name]

  if (page) {
    return [{ ...page, input: path.join(directory, `${page.id}.html`) }]
  }

  return templateCases(directory).map((entry) => ({ ...entry, directory }))
}

function compare(geaFile, reference, diffFile) {
  const gea = PNG.sync.read(readFileSync(geaFile))
  const browser = PNG.sync.read(reference)

  if (gea.width !== browser.width || gea.height !== browser.height) {
    throw new Error(
      `Image sizes differ (Gea ${gea.width} × ${gea.height}, Chromium ${browser.width} × ${browser.height})`,
    )
  }

  const diff = new PNG({ width: browser.width, height: browser.height })
  let changed = 0
  let maxDelta = 0

  for (let i = 0; i < diff.data.length; i += 4) {
    const delta = Math.max(
      Math.abs(gea.data[i] - browser.data[i]),
      Math.abs(gea.data[i + 1] - browser.data[i + 1]),
      Math.abs(gea.data[i + 2] - browser.data[i + 2]),
      Math.abs(gea.data[i + 3] - browser.data[i + 3]),
    )

    if (delta > 0) {
      changed++
      maxDelta = Math.max(maxDelta, delta)
      diff.data[i] = 255
      diff.data[i + 1] = 0
      diff.data[i + 2] = 122
    } else {
      const gray = Math.round((browser.data[i] + browser.data[i + 1] + browser.data[i + 2]) / 12)

      diff.data[i] = gray
      diff.data[i + 1] = gray
      diff.data[i + 2] = gray
    }

    diff.data[i + 3] = 255
  }

  writeFileSync(diffFile, PNG.sync.write(diff))

  return { changed, maxDelta, pixels: browser.width * browser.height }
}

const executable = localExecutable(root)
const hasLocalBuild = existsSync(executable)

if (!hasLocalBuild && !existsSync(path.join(root, 'dist', 'renderer-assets.json'))) {
  throw new Error(
    'Build the native renderer first with npm run render -- fixtures/card/card.html --out dist/card.png',
  )
}

const browser = await chromium.launch()
const chromiumVersion = browser.version()
const renderer = openRenderer(hasLocalBuild ? executable : undefined)
const results = []
const context = await browser.newContext({ deviceScaleFactor: 1, colorScheme: 'light' })

await context.route(/^https?:\/\//, (route) => route.abort())
const page = await context.newPage()

async function capturePage(name, entry, input) {
  const relative = path.join(name, entry.id)
  const directory = path.join(output, relative)
  const geaFile = path.join(directory, 'gea.png')
  const { width, height } = entry
  const result = { fixture: name, id: entry.id, width, height }

  mkdirSync(directory, { recursive: true })

  try {
    const gea = await renderer.capture({ input, out: geaFile, width, height, dpr: 1 })

    result.gea = path.join(relative, 'gea.png')
    result.geaMs = gea.ms
  } catch (error) {
    result.geaError = error.message
  }

  let reference

  try {
    await page.setViewportSize({ width, height })

    const started = performance.now()

    await page.goto(pathToFileURL(input).href, { waitUntil: 'load' })
    await page.locator('html').evaluate(async ({ ownerDocument }) => {
      await Promise.all([
        ownerDocument.fonts.ready,
        ...Array.from(ownerDocument.images, (image) => image.decode()),
      ])

      const failed = [...ownerDocument.fonts].filter((font) => font.status === 'error')

      if (failed.length) {
        throw new Error('Failed to load fonts: ' + failed.map((font) => font.family).join(', '))
      }
    })

    reference = await page.screenshot({
      animations: 'disabled',
      caret: 'hide',
      // Gea has no default body inset. Preserve any margin the fixture sets explicitly.
      style: ':where(body) { margin: 0; }',
    })

    result.chromiumMs = performance.now() - started
    result.chromium = path.join(relative, 'chromium.png')
    writeFileSync(path.join(directory, 'chromium.png'), reference)
  } catch (error) {
    result.chromiumError = error.message
  }

  if (result.gea && result.chromium) {
    try {
      Object.assign(result, compare(geaFile, reference, path.join(directory, 'diff.png')))
      result.diff = path.join(relative, 'diff.png')
    } catch (error) {
      result.diffError = error.message
    }
  }

  results.push(result)
  console.log(
    `${name}/${entry.id} ${result.changed === undefined ? 'capture or comparison failed' : `${result.changed}/${result.pixels} pixels differ`}`,
  )
}

try {
  for (const name of selected.length ? new Set(selected) : names) {
    for (const entry of casesFor(name)) {
      if (entry.input) {
        await capturePage(name, entry, entry.input)
      } else {
        await withRenderedPage(entry.directory, entry, (input) => capturePage(name, entry, input))
      }
    }
  }
} finally {
  await Promise.all([renderer.close(), browser.close()])
}

const metadata = {
  chromium: chromiumVersion,
  host: `${process.platform}-${process.arch} (${os.release()})`,
  renderer: hasLocalBuild ? executable : 'downloaded renderer',
}

writeReport(output, metadata, results)

const failures = results.filter((result) => result.changed === undefined).length
const exact = results.filter((result) => result.changed === 0).length

console.log(
  `Report: ${path.join(output, 'index.html')} (${results.length} comparisons, ${exact} exact, ${failures} errors)`,
)

if (failures || (values.strict && exact !== results.length)) {
  process.exitCode = 1
}
