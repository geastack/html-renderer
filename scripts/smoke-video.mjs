import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PNG } from 'pngjs'
import { renderFrames, renderVideo } from '../lib/worker.mjs'
import { localExecutable } from './local-executable.mjs'

const width = 128
const height = 72
const fps = 8
const ffmpeg = process.env.GEA_FFMPEG || 'ffmpeg'
const ffprobe = process.env.GEA_FFPROBE || 'ffprobe'

mkdirSync('dist', { recursive: true })
const media = resolve('dist/video-smoke-source.mp4')

execFileSync(ffmpeg, [
  '-v',
  'error',
  '-y',
  '-f',
  'lavfi',
  '-i',
  'testsrc2=size=96x48:rate=8',
  '-t',
  '2',
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  media,
])

const examples = {
  animation: `
    @keyframes travel {
      from { transform: translateX(0px); }
      50% { transform: translateX(40px); }
      to { transform: translateX(80px); }
    }
    .box { width: 16px; height: 16px; background-color: #ff0000; animation: travel 2s linear both; }
    </style></head><body><div class="box"></div></body></html>`,
  element: `
    video { position: absolute; left: 16px; top: 12px; width: 96px; height: 48px; }
    </style></head><body><video autoplay muted><source src="video-smoke-source.mp4"></video></body></html>`,
}
const frameBytes = width * height * 3

for (const [name, page] of Object.entries(examples)) {
  const input = resolve(`dist/video-smoke-${name}.html`)
  const out = resolve(`dist/video-smoke-${name}.mp4`)

  writeFileSync(
    input,
    `<!doctype html><html><head><style>body { margin: 0; background-color: #111111; }${page}`,
  )
  await renderVideo(
    { input, out, width, height, fps, quality: 9, start: 250, end: 1250 },
    { executable: localExecutable(process.cwd()) },
  )

  const { streams } = JSON.parse(
    execFileSync(ffprobe, [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_name,width,height,r_frame_rate,nb_frames',
      '-of',
      'json',
      out,
    ]),
  )

  assert.deepEqual(streams, [
    { codec_name: 'h264', width, height, r_frame_rate: '8/1', nb_frames: '8' },
  ])

  const pixels = execFileSync(ffmpeg, [
    '-v',
    'error',
    '-i',
    out,
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    'pipe:1',
  ])

  assert.equal(pixels.length, 8 * frameBytes)

  if (name === 'animation') {
    const red = (frame, x) => pixels[frame * frameBytes + (8 * width + x) * 3]

    assert.ok(red(0, 16) > 180 && red(0, 50) < 40, 'First frame is at 250 ms')
    assert.ok(red(7, 16) < 40 && red(7, 50) > 180, 'Last frame is at 1125 ms')
  } else {
    const frame = (index) =>
      pixels.subarray(
        (index * width * height + 12 * width) * 3,
        (index * width * height + 60 * width) * 3,
      )

    assert.notDeepEqual(frame(0), frame(7), 'Embedded video advances')
    assert.notDeepEqual(frame(1), frame(2), 'Embedded video updates during the clip')
  }

  console.log(`${name}: 8 H.264 frames at 8 fps`)
}

const framesDir = resolve(`dist/video-smoke-frames-${randomUUID()}`)
const frameRequest = {
  input: 'dist/video-smoke-animation.html',
  framesDir,
  width: 127,
  height: 71,
  fps,
  start: 250,
  end: 1250,
}
const options = { executable: localExecutable(process.cwd()) }

try {
  assert.equal(await renderFrames(frameRequest, options), 8)
  await assert.rejects(renderFrames(frameRequest, options), { code: 'EEXIST' })

  const files = readdirSync(framesDir).sort()

  assert.deepEqual(
    files,
    Array.from({ length: 8 }, (_, i) => `frame-00000${i}.png`),
  )

  const frames = files.map((name) => PNG.sync.read(readFileSync(resolve(framesDir, name))))

  assert.ok(frames.every((frame) => frame.width === 127 && frame.height === 71))
  const red = (frame, x) => frames[frame].data[(8 * 127 + x) * 4]

  assert.ok(red(0, 16) > 180 && red(0, 50) < 40, 'First PNG is at 250 ms')
  assert.ok(red(7, 16) < 40 && red(7, 50) > 180, 'Last PNG is at 1125 ms')

  console.log('PNG sequence: 8 RGBA frames at the original viewport size')
} finally {
  rmSync(framesDir, { recursive: true, force: true })
}
