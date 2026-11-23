import path from 'node:path'

export function localExecutable(root) {
  if (process.platform === 'win32') {
    const output = process.env.GEA_WINDOWS_OUTPUT_DIR || 'dist/windows'

    return path.resolve(root, output, 'html-renderer', 'Gea HTML Renderer.exe')
  }

  if (process.platform === 'linux') {
    const output = process.env.GEA_LINUX_OUTPUT_DIR || 'dist/raspberry-pi-os'

    return path.resolve(root, output, 'html-renderer', 'html-renderer')
  }

  const output = process.env.GEA_MACOS_OUTPUT_DIR || 'dist/macos'
  const namespace = process.env.GEA_MACOS_OUTPUT_TAG
    ? ['.namespaces', process.env.GEA_MACOS_OUTPUT_TAG]
    : []

  return path.resolve(
    root,
    output,
    ...namespace,
    'html-renderer',
    'Gea HTML Renderer.app',
    'Contents',
    'MacOS',
    'Gea HTML Renderer',
  )
}
