import { createServer } from 'node:http'
import { Buffer } from 'node:buffer'
import { renderHtml } from '../../../../src/render'

declare function capturePng(fast: boolean): Uint8Array
declare function preparePage(): void
declare function abortPage(): void
declare function finishPage(): void
declare function startCaptureMetrics(): void
declare function finishCaptureMetrics(): void
declare function httpPrerenderMode(): boolean
declare function captureMetrics(): string
declare function captureTotalMemory(): string
declare function openBundle(bytes: Uint8Array): string
declare function beginFileBundle(): void
declare function writeBundleFile(name: string, bytes: Uint8Array): void
declare function finishFileBundle(): string
declare function discardFileBundle(): void
declare function benchmarkFixturesEnabled(): boolean
declare function htmlSetAssetRoot(root: string): void

let mountedInput = ''
let mountedFast = true
let mountedPng: Uint8Array = new Uint8Array()

function capture(input: string, reuse: boolean, fast: boolean): Uint8Array {
  if (reuse && mountedInput === input && mountedFast === fast) {
    return mountedPng
  }

  mountedInput = ''
  mountedPng = new Uint8Array()
  preparePage()
  try {
    renderHtml(input)
  } catch (error) {
    abortPage()
    throw error
  }

  finishPage()

  const png = capturePng(fast)

  if (png.length > 0) {
    mountedInput = input
    mountedFast = fast
    mountedPng = png
  }

  return png
}

function serve(): void {
  createServer((request, response) => {
    const started = performance.now()
    const route = request.url

    if (request.method === 'GET' && route === '/health') {
      response.end('ok')

      return
    }

    const compression = request.headers['x-gea-png-compression'] ?? 'fast'

    if (compression !== 'fast' && compression !== 'compact') {
      response.statusCode = 400
      response.end('X-Gea-Png-Compression must be fast or compact')

      return
    }

    let input: string
    let reuse = true

    if (request.method === 'POST' && route === '/render') {
      try {
        const contentType = request.headers['content-type'] ?? ''

        if (typeof contentType === 'string' && contentType.startsWith('multipart/form-data')) {
          const body = request.readBody()

          if (body.length > 8 * 1024 * 1024) {
            throw new Error('Multipart request is too large')
          }

          const files = FormData.parseMultipart(body, contentType).getAll('files')

          if (files.length > 256) {
            throw new Error('Too many files')
          }

          beginFileBundle()
          for (const file of files) {
            if (!(file instanceof File)) {
              throw new Error('Expected an uploaded file')
            }

            writeBundleFile(file.name, Buffer.from(file.bytesString(), 'latin1'))
          }

          input = finishFileBundle()
        } else {
          input = openBundle(request.readBodyBytes())
        }
      } catch {
        response.statusCode = 400
        discardFileBundle()
        response.end('Send a ZIP or multipart files containing index.html')

        return
      }
    } else if (
      benchmarkFixturesEnabled() &&
      request.method === 'GET' &&
      (route === '/card' || route === '/promo' || route === '/card/cold' || route === '/promo/cold')
    ) {
      htmlSetAssetRoot('')
      const fixture = route.startsWith('/card') ? 'card' : 'promo'

      input = 'fixtures/' + fixture + '/' + fixture + '.html'
      reuse = !route.endsWith('/cold')
    } else {
      response.statusCode = 404
      response.end('Unknown route')

      return
    }

    let png: Uint8Array

    startCaptureMetrics()
    try {
      png = capture(input, reuse, compression === 'fast')
    } catch {
      response.statusCode = 500
      response.end('Capture failed')

      return
    } finally {
      finishCaptureMetrics()
    }

    if (png.length === 0) {
      response.statusCode = 500
      response.end('Capture failed')

      return
    }

    response.setHeader('x-gea-capture', captureMetrics())
    response.setHeader('x-gea-memory-current-peak', captureTotalMemory())
    response.setHeader('content-type', 'image/png')
    response.setHeader('content-length', String(png.length))
    response.setHeader('x-bench-container-ms', String(performance.now() - started))
    response.end(png)
  }).listen(8080, '0.0.0.0')
}

if (httpPrerenderMode()) {
  serve()
} else {
  renderHtml(htmlInput())
}
