// Renders a template fixture once per entry in its data.json.
// Usage: node fixtures/shared/generate.mjs fixtures/<example> [out-dir]
//
// template.html uses {{key}} for escaped values and {{#list}}...{{/list}}
// to repeat a block for each item of an array. Inside a block, {{index}} is
// the item's 1-based position. data.json holds { width, height, entries },
// and every entry needs an id, which names its PNG. An entry can set its
// own width and height to override the defaults.
// Uses a local build when there is one and the downloaded renderer otherwise.

import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openRenderer } from '../../lib/worker.mjs'
import { localExecutable } from '../../scripts/local-executable.mjs'
import { templateCases, withRenderedPage } from './templates.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const [exampleArg, outArg] = process.argv.slice(2)

if (!exampleArg) {
  console.error('Usage: node fixtures/shared/generate.mjs fixtures/<example> [out-dir]')
  process.exit(2)
}

const example = path.resolve(exampleArg)
const name = path.basename(example)
const outDir = path.resolve(outArg || path.join(root, 'dist', name))
const local = localExecutable(root)
const executable = existsSync(local) ? local : undefined

mkdirSync(outDir, { recursive: true })
const renderer = openRenderer(executable)

try {
  for (const entry of templateCases(example)) {
    const result = await withRenderedPage(example, entry, (input) =>
      renderer.capture({
        input,
        out: path.join(outDir, `${entry.id}.png`),
        width: entry.width,
        height: entry.height,
      }),
    )

    console.log(`${name}/${entry.id}.png rendered in ${result.ms.toFixed(1)} ms`)
  }
} finally {
  await renderer.close()
}
