import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'

const ready = 'document.fonts.ready.then(() => true)'

export async function openChrome({ executablePath, args, profile, viewport, headless }) {
  const child = spawn(
    executablePath,
    [
      ...args,
      ...(headless ? ['--headless=new'] : []),
      '--remote-debugging-pipe',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] },
  )
  const closed = new Promise((resolve) => child.once('close', resolve))
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
      async close() {
        try {
          await send('Browser.close')
        } catch {
          child.kill()
        }

        await closed
        await rm(profile, { recursive: true, force: true, maxRetries: 2 })
      },
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
    await closed
    await rm(profile, { recursive: true, force: true, maxRetries: 2 })
    throw error
  }
}
