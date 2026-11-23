import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const platforms = ['darwin-arm64', 'linux-x64', 'win32-x64']
const dir = 'dist/native-release'
const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
const tag = `renderer-v${version}`
const { GITHUB_REPOSITORY: repo, GITHUB_SHA: commit } = process.env
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' }).trim()
const artifacts = platforms.map((platform) => {
  const artifact = JSON.parse(readFileSync(path.join(dir, `${platform}.json`), 'utf8'))

  if (
    artifact.platform !== platform ||
    artifact.archive !== `gea-html-renderer-${platform}.tar.gz`
  ) {
    throw new Error(`Unexpected release metadata for ${platform}`)
  }

  return artifact
})

if (spawnSync('gh', ['release', 'view', tag], { stdio: 'ignore' }).status !== 0) {
  gh('release', 'create', tag, '--target', commit, '--title', `Renderer binaries ${version}`)
} else if (gh('api', `repos/${repo}/git/ref/tags/${tag}`, '--jq', '.object.sha') !== commit) {
  throw new Error(`Renderer release tag ${tag} points to another commit`)
}

const existing = new Set(
  gh('release', 'view', tag, '--json', 'assets', '--jq', '.assets[].name').split('\n'),
)
const assets = {}

for (const { platform, archive, executable } of artifacts) {
  const file = path.join(dir, archive)

  if (existing.has(archive)) {
    gh('release', 'download', tag, '--pattern', archive, '--output', file, '--clobber')
  } else {
    gh('release', 'upload', tag, file)
  }

  assets[platform] = {
    url: `https://github.com/${repo}/releases/download/${tag}/${archive}`,
    sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
    executable,
  }
}

writeFileSync('dist/renderer-assets.json', JSON.stringify(assets) + '\n')
