import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'

const npm = process.env.npm_execpath

if (!npm) {
  throw new Error('Run this check with npm run smoke:package')
}

const platform = `${process.platform}-${process.arch}`
const asset = JSON.parse(readFileSync(`dist/native-release/${platform}.json`, 'utf8'))
const archive = readFileSync(`dist/native-release/${asset.archive}`)
let downloads = 0
const server = createServer((_request, response) => {
  downloads++
  response.end(archive)
})

await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})

try {
  writeFileSync(
    'dist/renderer-assets.json',
    JSON.stringify({
      [platform]: {
        url: `http://127.0.0.1:${server.address().port}/${asset.archive}`,
        sha256: createHash('sha256').update(archive).digest('hex'),
        executable: asset.executable,
      },
    }),
  )

  const tarball = execFileSync(
    process.execPath,
    [npm, 'pack', '--pack-destination', 'dist', '--silent'],
    {
      encoding: 'utf8',
    },
  ).trim()
  const file = path.resolve('dist', tarball)

  writeFileSync(
    'dist/package.json',
    JSON.stringify({ private: true, allowScripts: { [`file:${file}`]: true } }),
  )

  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [npm, 'install', '--prefix', 'dist', '--no-save', '--no-package-lock', file],
      { stdio: 'inherit' },
    )

    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`npm install failed (${code})`))
      }
    })
  })

  const installed = 'dist/node_modules/@geastack/html-renderer'

  if (downloads !== 1 || !existsSync(path.join(installed, 'dist/prebuilt', asset.executable))) {
    throw new Error('The npm install hook did not download and install the renderer')
  }

  execFileSync(
    process.execPath,
    ['scripts/smoke-svg.mjs', path.resolve(installed, 'dist/prebuilt', asset.executable)],
    { stdio: 'inherit' },
  )

  const output = 'dist/installed.png'

  execFileSync(
    process.execPath,
    [path.join(installed, 'bin/cli.mjs'), 'fixtures/card/card.html', '--out', output],
    { stdio: 'inherit' },
  )

  const png = readFileSync(output)

  if (png.readUInt32BE(16) !== 1920 || png.readUInt32BE(20) !== 1080 || downloads !== 1) {
    throw new Error('Expected a 1920 × 1080 PNG from the installed renderer after one download')
  }

  if (process.platform === 'linux') {
    const cli = path.join(installed, 'bin/cli.mjs')
    const input = 'fixtures/card/card.html'
    const fast = 'dist/installed-fast.png'
    const frames = 'dist/installed-frames'

    execFileSync(process.execPath, [cli, input, '--out', fast, '--png-compression', 'fast'])
    execFileSync(process.execPath, [
      cli,
      input,
      '--frames-dir',
      frames,
      '--fps',
      '10',
      '--end',
      '100ms',
    ])
    const frame = readFileSync(path.join(frames, 'frame-000000.png'))

    if (readFileSync(fast).equals(png) || !frame.equals(png)) {
      throw new Error('Expected distinct Fast encoding and a matching Compact PNG frame')
    }
  }

  console.log(`${platform}: npm installed the renderer and the CLI wrote a 1920 × 1080 PNG`)
} finally {
  server.close()
}
