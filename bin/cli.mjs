#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { openRenderer } from '../lib/worker.mjs'

const usage = 'Usage: gea-html-render page.html --out page.png [--width 1920 --height 1080 --dpr 1]'

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      out: { type: 'string', short: 'o' },
      width: { type: 'string', default: '1920' },
      height: { type: 'string', default: '1080' },
      dpr: { type: 'string', default: '1' },
    },
  })
  const [input] = positionals
  const { out } = values

  if (values.help) {
    console.log(usage)
  } else {
    if (positionals.length !== 1 || !out) {
      throw new Error(usage)
    }

    const width = Number(values.width)
    const height = Number(values.height)
    const dpr = Number(values.dpr)

    if (![width, height].every((n) => Number.isSafeInteger(n) && n > 0)) {
      throw new Error('Width and height must be positive integers')
    }

    if (!Number.isFinite(dpr) || dpr <= 0) {
      throw new Error('DPR must be a positive number')
    }

    const renderer = openRenderer()

    try {
      await renderer.capture({ input, out, width, height, dpr })
    } finally {
      await renderer.close()
    }
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
