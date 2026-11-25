import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { PNG } from 'pngjs'
import { openRenderer } from '../lib/worker.mjs'
import { localExecutable } from './local-executable.mjs'

const fixture = 'fixtures/svg-illustration/svg-illustration.html'
const out = 'dist/svg-smoke.png'
const target = process.argv[2]

if (target?.startsWith('http://') || target?.startsWith('https://')) {
  const form = new FormData()
  const html = await readFile(fixture, 'utf8')
  const css = await readFile('fixtures/shared/capture-type.css', 'utf8')

  form.append('files', new Blob([html.replace('../shared/', '')]), 'index.html')
  form.append('files', new Blob([css.replaceAll('fonts/', '')]), 'capture-type.css')
  form.append(
    'files',
    new Blob([await readFile('fixtures/svg-illustration/orbit.svg')]),
    'orbit.svg',
  )

  for (const [, name] of css.matchAll(/url\("fonts\/([^"]+)"\)/g)) {
    form.append('files', new Blob([await readFile(`fixtures/shared/fonts/${name}`)]), name)
  }

  const response = await fetch(new URL('/render', target), {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(30_000),
  })

  if (!response.ok) {
    throw new Error(`SVG fixture returned HTTP ${response.status}: ${await response.text()}`)
  }

  await writeFile(out, Buffer.from(await response.arrayBuffer()))
} else {
  const renderer = openRenderer(target ?? localExecutable(process.cwd()))

  try {
    await renderer.capture({ input: fixture, out, width: 360, height: 184 })
  } finally {
    await renderer.close()
  }
}

const { data, width, height } = PNG.sync.read(await readFile(out))

// The painted artwork has transparent margins inside the 160×100 and
// 80×50 image boxes. Ignore the background and the heading above the SVGs.
const sizes = [
  [24, 184],
  [204, 284],
].map(([left, right]) => {
  const columns = new Set()
  const rows = new Set()

  for (let y = 62; y < Math.min(height, 184); y++) {
    for (let x = left; x < right; x++) {
      const offset = (y * width + x) * 4
      const [red, green, blue] = data.subarray(offset, offset + 3)

      if (red >= 65 || green >= 80 || blue >= 100) {
        columns.add(x)
        rows.add(y)
      }
    }
  }

  return [columns.size, rows.size]
})

assert.deepEqual(sizes, [
  [134, 72],
  [67, 36],
])
console.log(`SVG artwork painted at ${sizes.map((size) => size.join('×')).join(' and ')} pixels`)
