import { RendererContainer } from './container'

export { RendererContainer }

interface Env {
  RENDER: DurableObjectNamespace<RendererContainer>
  RENDER_TOKEN: string
}

export default {
  fetch(request: Request, env: Env) {
    if (
      !env.RENDER_TOKEN ||
      request.headers.get('Authorization') !== `Bearer ${env.RENDER_TOKEN}`
    ) {
      return new Response('Unauthorized', { status: 401 })
    }

    return env.RENDER.getByName('renderer').fetch(request)
  },
}
