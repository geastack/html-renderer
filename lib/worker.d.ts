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

export function openRenderer(executable?: string, options?: { cwd?: string }): Renderer

export interface VideoRequest {
  input: string
  out: string
  width?: number
  height?: number
  dpr?: number
  fps?: number
  /** Video quality from 1 (smallest) to 10 (highest). Defaults to 8. */
  quality?: number
  /** Inclusive start time in milliseconds. Defaults to zero. */
  start?: number
  /** Exclusive end time in milliseconds. */
  end: number
}

export function renderVideo(
  request: VideoRequest,
  options?: { executable?: string; cwd?: string },
): Promise<void>

export interface FrameSequenceRequest extends Omit<VideoRequest, 'out' | 'quality'> {
  framesDir: string
}

/** Returns the number of PNG frames written to the new directory. */
export function renderFrames(
  request: FrameSequenceRequest,
  options?: { executable?: string; cwd?: string },
): Promise<number>
