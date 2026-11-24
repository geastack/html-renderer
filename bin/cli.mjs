#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { videoTime } from '../lib/video.mjs'
import { openRenderer, renderFrames, renderVideo } from '../lib/worker.mjs'

const usage =
  'Usage: gea-html-render page.html --out page.png [--width 1920 --height 1080 --dpr 1]\n' +
  '       gea-html-render page.html --out page.mp4 --end TIME [--start TIME --fps 60 --quality 8]\n' +
  '       gea-html-render page.html --frames-dir DIR --end TIME [--start TIME --fps 60]'

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      out: { type: 'string', short: 'o' },
      'frames-dir': { type: 'string' },
      width: { type: 'string', default: '1920' },
      height: { type: 'string', default: '1080' },
      start: { type: 'string' },
      end: { type: 'string' },
      fps: { type: 'string' },
      quality: { type: 'string' },
      dpr: { type: 'string', default: '1' },
    },
  })
  const [input] = positionals
  const { out, 'frames-dir': framesDir } = values
  const frames = framesDir !== undefined

  if (values.help) {
    console.log(usage)
  } else {
    if (positionals.length !== 1 || (frames ? out !== undefined || !framesDir.trim() : !out)) {
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

    if (frames || out.toLowerCase().endsWith('.mp4')) {
      const start = videoTime(values.start ?? '0')
      const end = videoTime(values.end)
      const fps = Number(values.fps ?? 60)

      if (!(start >= 0 && end > start && end <= 2147483647)) {
        throw new Error(
          'Sequence export requires --end after --start (for example --start 1s --end 5s)',
        )
      }

      const request = { input, width, height, dpr, fps, start, end }

      if (frames) {
        if (values.quality !== undefined) {
          throw new Error('--quality requires an MP4 output')
        }

        await renderFrames({ ...request, framesDir })
      } else {
        const quality = Number(values.quality ?? 8)

        if (values.quality?.trim() === '') {
          throw new Error('Quality must be an integer between 1 and 10')
        }

        await renderVideo({ ...request, out, quality })
      }
    } else {
      if (
        values.start !== undefined ||
        values.end !== undefined ||
        values.fps !== undefined ||
        values.quality !== undefined
      ) {
        throw new Error(
          'Time and FPS settings require an MP4 output or --frames-dir. Quality is MP4 only.',
        )
      }

      const renderer = openRenderer()

      try {
        await renderer.capture({ input, out, width, height, dpr })
      } finally {
        await renderer.close()
      }
    }
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
