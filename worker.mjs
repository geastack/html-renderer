import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

/**
 * Start a compiled Gea HTML renderer. Captures can be queued in order.
 * Provide the native executable path produced by the macOS build.
 */
export function openRenderer(executable, { cwd = process.cwd() } = {}) {
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
