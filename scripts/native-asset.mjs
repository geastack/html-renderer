import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { localExecutable } from './local-executable.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const executable = localExecutable(root)
const platform = `${process.platform}-${process.arch}`
const stage = path.join(root, 'dist', 'native-release')
const bundle = path.join(stage, 'prebuilt')

mkdirSync(bundle, { recursive: true })

let entry = path.basename(executable)

if (process.platform === 'darwin') {
  const app = path.resolve(executable, '../../..')

  execFileSync('ditto', [app, path.join(bundle, path.basename(app))], { stdio: 'inherit' })
  entry = path.relative(path.dirname(app), executable)
} else {
  cpSync(executable, path.join(bundle, entry))

  const resources = process.platform === 'win32' ? 'Resources' : 'resources'
  const source = path.join(path.dirname(executable), resources)

  if (existsSync(source)) {
    cpSync(source, path.join(bundle, resources), { recursive: true })
  }
}

const target = { darwin: 'apple', linux: 'linux', win32: 'windows' }[process.platform]

cpSync(path.join(root, '..', target, 'NOTICE'), path.join(bundle, `NOTICE-${target}`))
cpSync(path.join(root, '..', 'core', 'NOTICE'), path.join(bundle, 'NOTICE-core'))
cpSync(path.join(root, '..', 'compiler', 'NOTICE'), path.join(bundle, 'NOTICE-compiler'))
cpSync(path.join(root, 'fixtures', 'fonts', 'OFL.txt'), path.join(bundle, 'OFL-Barlow.txt'))

const archive = `gea-html-renderer-${platform}.tar.gz`

execFileSync('tar', ['-czf', path.join(stage, archive), '-C', stage, 'prebuilt'], {
  stdio: 'inherit',
})
writeFileSync(
  path.join(stage, `${platform}.json`),
  JSON.stringify({ platform, archive, executable: entry.split(path.sep).join('/') }) + '\n',
)
