import { createServer } from 'node:http'

declare function capturePng(input: string, reuse: boolean): Uint8Array
declare function captureMetrics(): string

createServer((request, response) => {
  const started = performance.now()
  const route = request.url

  if (request.method === 'GET' && route === '/health') {
    response.end('ok')

    return
  }

  if (
    request.method !== 'GET' ||
    (route !== '/card' && route !== '/promo' && route !== '/card/cold' && route !== '/promo/cold')
  ) {
    response.statusCode = 404
    response.end('Unknown route')

    return
  }

  const fixture = route.startsWith('/card') ? 'card' : 'promo'
  const png = capturePng('fixtures/' + fixture + '/' + fixture + '.html', !route.endsWith('/cold'))

  if (png.length === 0) {
    response.statusCode = 500
    response.end('Capture failed')

    return
  }

  response.setHeader('x-gea-capture', captureMetrics())
  response.setHeader('content-type', 'image/png')
  response.setHeader('content-length', String(png.length))
  response.setHeader('x-bench-container-ms', String(performance.now() - started))
  response.end(png)
}).listen(8080, '0.0.0.0')
