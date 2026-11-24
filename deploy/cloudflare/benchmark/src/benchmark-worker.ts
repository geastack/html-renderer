import { Container, getContainer } from '@cloudflare/containers'

export class RenderBenchmark extends Container {
  defaultPort = 8080
  sleepAfter = '2m'
  enableInternet = false
}

interface Env {
  RENDER: Parameters<typeof getContainer<RenderBenchmark>>[0]
  BENCHMARK_TOKEN: string
}

export default {
  async fetch(request: Request, env: Env) {
    if (
      !env.BENCHMARK_TOKEN ||
      request.headers.get('Authorization') !== `Bearer ${env.BENCHMARK_TOKEN}`
    ) {
      return new Response('Unauthorized', { status: 401 })
    }

    return getContainer(env.RENDER, 'render-benchmark-v3').fetch(request)
  },
}
