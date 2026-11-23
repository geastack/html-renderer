import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const dist = fileURLToPath(new URL('../dist/', import.meta.url))

export async function installRenderer() {
  const platform = `${process.platform}-${process.arch}`
  const assets = JSON.parse(readFileSync(join(dist, 'renderer-assets.json'), 'utf8'))
  const asset = assets[platform]

  if (!asset) {
    throw new Error(
      `Gea HTML Renderer has no binary for ${platform}. Available: ${Object.keys(assets).join(', ')}`,
    )
  }

  const destination = join(dist, 'prebuilt')
  const executable = join(destination, asset.executable)

  if (existsSync(executable)) {
    return executable
  }

  const staging = mkdtempSync(join(dist, 'install-'))

  try {
    const response = await fetch(asset.url, { signal: AbortSignal.timeout(120_000) })

    if (!response.ok) {
      throw new Error(`Renderer download failed (HTTP ${response.status})`)
    }

    const archive = Buffer.from(await response.arrayBuffer())

    if (createHash('sha256').update(archive).digest('hex') !== asset.sha256) {
      throw new Error('Renderer archive checksum mismatch')
    }

    const archivePath = join(staging, 'renderer.tgz')

    writeFileSync(archivePath, archive)
    execFileSync('tar', ['-xzf', basename(archivePath)], { cwd: staging })
    const bundle = join(staging, basename(destination))

    if (!existsSync(join(bundle, asset.executable))) {
      throw new Error('Renderer archive is missing its executable')
    }

    try {
      renameSync(bundle, destination)
    } catch (error) {
      if (!existsSync(executable)) {
        throw error
      }
    }

    return executable
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    await installRenderer()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
