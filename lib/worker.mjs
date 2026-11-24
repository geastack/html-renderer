import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { writePrerenderFrames } from './frames.mjs'
import { installRenderer } from './install.mjs'
import { encodePrerenderVideo } from './video.mjs'

/** Render a page once and encode the requested millisecond range as MP4. */
export function renderVideo(request, options) {
  return renderSequence(request, options, false)
}

/** Render a page once and write each frame as an RGBA PNG in a new directory. */
export function renderFrames(request, options) {
  const { framesDir, ...capture } = request

  return renderSequence({ ...capture, out: framesDir }, options, true)
}

async function renderSequence(
  { input, out, width = 1920, height = 1080, dpr = 1, fps = 60, quality = 8, start = 0, end },
  { executable, cwd = process.cwd() } = {},
  frames,
) {
  if (typeof input !== 'string' || !input.trim() || typeof out !== 'string' || !out.trim()) {
    throw new Error('Expected input and output paths')
  }

  if (!frames && !out.toLowerCase().endsWith('.mp4')) {
    throw new Error('Expected an MP4 output path')
  }

  if (
    ![width, height].every((value) => Number.isInteger(value) && value >= 1 && value <= 8192) ||
    !Number.isFinite(dpr) ||
    dpr < 0.1 ||
    dpr > 8
  ) {
    throw new Error('Invalid export viewport or DPR')
  }

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end <= start ||
    end > 2147483647
  ) {
    throw new Error('Sequence export requires an end time after the start time in milliseconds')
  }

  if (!Number.isInteger(fps) || fps < 1 || fps > 1000) {
    throw new Error('FPS must be an integer between 1 and 1000')
  }

  if (!Number.isInteger(quality) || quality < 1 || quality > 10) {
    throw new Error('Quality must be an integer between 1 and 10')
  }

  const capture = {
    executable: executable ?? (await installRenderer()),
    cwd,
    env: { ...process.env, GEA_PRERENDER_INPUT: resolve(cwd, input) },
    out: resolve(cwd, out),
    width,
    height,
    dpr,
    fps,
    quality,
    start,
    end,
  }

  if (frames) {
    return writePrerenderFrames(capture)
  }

  await encodePrerenderVideo(capture)
}

/** Start a native worker. Captures are processed in order. */
export function openRenderer(executable, { cwd = process.cwd() } = {}) {
  if (executable) {
    return startWorker(executable, cwd)
  }

  let worker
  let closing = false

  return {
    async capture(request) {
      if (closing) {
        throw new Error('Gea renderer is closing')
      }

      worker ??= installRenderer().then((path) => startWorker(path, cwd))

      return (await worker).capture(request)
    },
    async close() {
      closing = true
      const active = await worker?.catch(() => undefined)

      await active?.close()
    },
  }
}

function startWorker(executable, cwd) {
  const child = spawn(executable, ['--gea-prerender-worker'], {
    cwd,
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const pending = []
  let stopped
  let closing = false
  const failPending = (error) => {
    stopped ??= error
    for (const request of pending.splice(0)) {
      request.reject(stopped)
    }
  }

  const finished = new Promise((resolve) => {
    child.on('error', failPending)
    child.on('close', (code, signal) => {
      failPending(new Error(`Gea renderer stopped (${signal ?? code})`))
      resolve()
    })
  })

  child.stdin.on('error', failPending)
  createInterface({ input: child.stdout }).on('line', (line) => {
    const request = pending.shift()

    if (!request) {
      return
    }

    try {
      const reply = JSON.parse(line)

      if (!reply.ok) {
        request.reject(new Error(reply.error ?? 'Gea capture failed'))
      } else {
        request.resolve(reply)
      }
    } catch (error) {
      request.reject(error)
      failPending(error)
      child.kill()
    }
  })

  return {
    capture(request) {
      if (stopped || closing) {
        return Promise.reject(stopped ?? new Error('Gea renderer is closing'))
      }

      return new Promise((resolve, reject) => {
        const line = JSON.stringify(request)

        pending.push({ resolve, reject })
        child.stdin.write(line + '\n')
      })
    },
    close() {
      if (!closing) {
        closing = true
        child.stdin.end()
      }

      return finished
    },
  }
}
