import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const app = process.cwd()
const server = path.join(app, 'deploy/cloudflare/src/native')
const out = process.argv[2]
const requireApp = createRequire(path.join(app, 'package.json'))
const compiler = path.dirname(requireApp.resolve('@geastack/compiler/package.json'))
const compatBuild = requireApp.resolve('@geastack/node-compat/build')
const ts = requireApp('typescript')
const core = path.dirname(requireApp.resolve('@geastack/core/package.json'))
const coreDeclarations = path.join(core, 'index.d.ts')
const source = fs.readFileSync(coreDeclarations, 'utf8')
const types = ts.createSourceFile(coreDeclarations, source, ts.ScriptTarget.Latest, true)

// Select node-compat as the owner of these globals in the HTTP program.
// Keep Gea's DOM declarations at the same path, where its plugin identifies them.
const nodeGlobals = new Set([
  'console',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
])
const edits = []

for (const statement of types.statements) {
  if (!ts.isModuleDeclaration(statement) || !(statement.flags & ts.NodeFlags.GlobalAugmentation)) {
    continue
  }

  for (const declaration of statement.body.statements) {
    const names = ts.isFunctionDeclaration(declaration)
      ? [declaration.name?.text]
      : ts.isVariableStatement(declaration)
        ? declaration.declarationList.declarations.map((entry) => entry.name.text)
        : []

    if (names.length && names.every((name) => nodeGlobals.has(name))) {
      edits.push([declaration.getStart(types), declaration.end])
    }
  }
}

let overlay = source

for (const [start, end] of edits.reverse()) {
  overlay =
    overlay.slice(0, start) + overlay.slice(start, end).replace(/[^\n]/g, ' ') + overlay.slice(end)
}

fs.mkdirSync(out, { recursive: true })
const overlayFile = path.join(out, 'source-overlay.json')

fs.writeFileSync(overlayFile, JSON.stringify({ [coreDeclarations]: overlay }))
const result = spawnSync(
  process.execPath,
  [
    compatBuild,
    path.join(server, 'server.ts'),
    '--out',
    out,
    '--emit-only',
    '--globals',
    '--host-plugin',
    requireApp.resolve('@geastack/geatsc-plugin-gea'),
    '--host-plugin',
    path.join(app, 'src/geatsc-plugin.mjs'),
    '--host-plugin',
    path.join(server, 'plugin.mjs'),
    '--entry-name',
    'gea_renderer_http_serve',
    '--top-level-name',
    '__gea_top_level',
    '--source-overlay',
    overlayFile,
  ],
  { env: { ...process.env, GEA_COMPILER_DIR: compiler, GEA_CORE_DIR: core }, stdio: 'inherit' },
)

if (result.error) {
  throw result.error
}

process.exitCode = result.status ?? 1
