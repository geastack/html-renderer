import { Container, getContainer } from '@cloudflare/containers'

import { RendererContainer, timedResponse } from '../../src/container'

export class RenderBenchmark extends Container {
  defaultPort = 8080
  sleepAfter = '2m'
  enableInternet = false

  override async onActivityExpired() {
    await this.destroy()
  }

  override async fetch(request: Request) {
    if (request.method === 'POST' && new URL(request.url).pathname === '/__benchmark/reset') {
      if (this.ctx.container?.running) {
        await this.destroy()
      }

      return new Response(null, { status: 204 })
    }

    const started = performance.now()

    if (new URL(request.url).pathname === '/__benchmark/do-ping') {
      return timedResponse(new Response('ok'), 'x-bench-do-ms', started)
    }

    const response = await super.fetch(request)

    return timedResponse(response, 'x-bench-do-ms', started)
  }
}

export class ColocatedRenderBenchmark extends RendererContainer {
  override async fetch(request: Request) {
    const started = performance.now()
    const url = new URL(request.url)
    const container = this.ctx.container!

    if (request.method === 'POST' && url.pathname === '/__benchmark/reset') {
      if (this.readiness) {
        await this.readiness.catch(() => {})
      }

      if (container.running) {
        await container.destroy()
      }

      this.readiness = undefined

      return new Response(null, { status: 204 })
    }

    if (url.pathname === '/__benchmark/do-ping') {
      return timedResponse(new Response('ok'), 'x-bench-do-ms', started)
    }

    return super.fetch(request)
  }
}

interface Env {
  RENDER: Parameters<typeof getContainer<RenderBenchmark>>[0]
  BENCHMARK_TOKEN: string
  RENDER_INSTANCE_TYPE?: 'lite' | 'basic'
}

export default {
  async fetch(request: Request, env: Env) {
    if (
      !env.BENCHMARK_TOKEN ||
      request.headers.get('Authorization') !== `Bearer ${env.BENCHMARK_TOKEN}`
    ) {
      return new Response('Unauthorized', { status: 401 })
    }

    const run = request.headers.get('x-gea-benchmark-instance')

    if (run && !/^[0-9a-f-]{36}$/.test(run)) {
      return new Response('Invalid benchmark instance', { status: 400 })
    }

    const started = performance.now()

    if (new URL(request.url).pathname === '/__benchmark/worker-ping') {
      return timedResponse(new Response('ok'), 'x-bench-worker-ms', started)
    }

    const response = await getContainer(env.RENDER, run ?? 'render-benchmark-v4').fetch(request)

    return timedResponse(response, 'x-bench-worker-ms', started)
  },
}
