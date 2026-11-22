import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const workspace = path.dirname(root)
const [input, ...options] = process.argv.slice(2)
if (input === '--serve') {
  if (options.length) {
    console.error('Pass viewport and output settings in each JSON request')
    process.exit(2)
  }
  const outputRoot = path.resolve(root, process.env.GEA_MACOS_OUTPUT_DIR || 'dist/macos')
  const namespace = process.env.GEA_MACOS_OUTPUT_TAG ? ['.namespaces', process.env.GEA_MACOS_OUTPUT_TAG] : []
  const exe = path.join(outputRoot, ...namespace, 'html-renderer', 'Gea HTML Renderer.app', 'Contents', 'MacOS', 'Gea HTML Renderer')
  if (!existsSync(exe)) {
    console.error('Build the renderer once with npm run render before starting the worker.')
    process.exit(2)
  }
  const worker = spawnSync(exe, ['--gea-prerender-worker'], { stdio: 'inherit' })
  if (worker.error) throw worker.error
  process.exit(worker.status ?? 1)
}
if (!input || input === '--help') {
  console.log('Usage: npm run render -- page.html --out page.png [--width W --height H --dpr N]\n       node render.mjs --serve')
  process.exit(input ? 0 : 2)
}
const inputPath = path.resolve(input)
if (!existsSync(inputPath) || !statSync(inputPath).isFile()) {
  console.error(`HTML file not found: ${inputPath}`)
  process.exit(2)
}

const env = { ...process.env, GEA_HTML_INPUT: inputPath }
for (const [variable, directory] of [
  ['GEA_APPLE_ROOT', 'apple/packages/geastack-apple'],
  ['GEA_CORE', 'core/packages/core'],
  ['GEA_COMPILER', 'compiler'],
]) {
  const local = path.join(workspace, directory)
  if (!env[variable] && existsSync(path.join(local, 'package.json'))) env[variable] = local
}

const localCli = path.join(workspace, 'cli', 'bin', 'gea.mjs')
const cli = existsSync(localCli) ? localCli : path.join(root, 'node_modules', '@geastack/cli', 'bin', 'gea.mjs')
const child = spawnSync(process.execPath, [cli, 'prerender', '--project', root, '--app', 'html-renderer', ...options], {
  cwd: process.cwd(),
  env,
  stdio: 'inherit',
})
if (child.error) throw child.error
process.exitCode = child.status ?? 1
