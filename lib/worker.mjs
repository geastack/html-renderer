import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { installRenderer } from './install.mjs'

/** Start a native worker. Captures are processed in order. */
export function openRenderer(executable, { cwd = process.cwd() } = {}) {
  if (executable) return startWorker(executable, cwd)

  let worker
  let closing = false
  return {
    async capture(request) {
      if (closing) throw new Error('Gea renderer is closing')
      worker ??= installRenderer().then(path => startWorker(path, cwd))
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
  const failPending = error => {
    stopped ??= error
    for (const request of pending.splice(0)) request.reject(stopped)
  }
  const finished = new Promise(resolve => {
    child.on('error', failPending)
    child.on('close', (code, signal) => {
      failPending(new Error(`Gea renderer stopped (${signal ?? code})`))
      resolve()
    })
  })
  child.stdin.on('error', failPending)
  createInterface({ input: child.stdout }).on('line', line => {
    const request = pending.shift()
    if (!request) return
    try {
      const reply = JSON.parse(line)
      if (!reply.ok) request.reject(new Error(reply.error ?? 'Gea capture failed'))
      else request.resolve(reply)
    } catch (error) {
      request.reject(error)
      failPending(error)
      child.kill()
    }
  })

  return {
    capture(request) {
      if (stopped || closing) return Promise.reject(stopped ?? new Error('Gea renderer is closing'))
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
