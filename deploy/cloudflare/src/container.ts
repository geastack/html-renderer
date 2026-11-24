import { DurableObject } from 'cloudflare:workers'

export interface ContainerEnv {
  RENDER_INSTANCE_TYPE?: 'lite' | 'basic'
}

export function timedResponse(response: Response, name: string, started: number) {
  const result = new Response(response.body, response)

  result.headers.set(name, (performance.now() - started).toFixed(3))

  return result
}

export class RendererContainer extends DurableObject<ContainerEnv> {
  protected readiness?: Promise<void>

  constructor(ctx: DurableObjectState, env: ContainerEnv) {
    super(ctx, env)
    if (ctx.container?.running) {
      void ctx.blockConcurrencyWhile(() => ctx.container!.setInactivityTimeout(120_000))
    }
  }

  private async start() {
    const container = this.ctx.container!

    if (!container.running) {
      container.start({
        image: container.images.base,
        instance: this.env.RENDER_INSTANCE_TYPE ?? 'lite',
        enableInternet: false,
      })
      await container.setInactivityTimeout(120_000)
    }

    const port = container.getTcpPort(8080)

    for (let attempt = 0; attempt < 120; attempt++) {
      const health = await port.fetch('http://container/health').catch(() => undefined)

      if (health?.ok) {
        await health.arrayBuffer()

        return
      }

      await new Promise((resolve) => setTimeout(resolve, 250))
    }

    throw new Error('Container did not become ready')
  }

  async fetch(request: Request) {
    const started = performance.now()
    const url = new URL(request.url)
    const container = this.ctx.container!

    if (!container.running) {
      this.readiness = undefined
    }

    this.readiness ??= this.start().catch((error) => {
      this.readiness = undefined

      throw error
    })
    try {
      await this.readiness
      const response = await container
        .getTcpPort(8080)
        .fetch(new Request('http://container' + url.pathname + url.search, request))

      return timedResponse(response, 'x-bench-do-ms', started)
    } catch (error) {
      return new Response(String(error), { status: 503 })
    }
  }
}
