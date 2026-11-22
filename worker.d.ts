export interface CaptureRequest {
  input: string
  out: string
  width?: number
  height?: number
  dpr?: number
  reusePage?: boolean
}

export interface CaptureResult {
  ok: true
  ms: number
  reusedPage: boolean
}

export interface Renderer {
  capture(request: CaptureRequest): Promise<CaptureResult>
  close(): Promise<void>
}

export function openRenderer(executable: string, options?: { cwd?: string }): Renderer
