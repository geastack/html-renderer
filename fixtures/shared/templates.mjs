import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function fill(source, values) {
  const withLists = source.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, block) => {
    const items = values[key] || []

    return items
      .map((item, index) => fill(block, { ...values, ...item, index: index + 1 }))
      .join('')
  })

  return withLists.replace(/\{\{(\w+)\}\}/g, (_, key) => escapeHtml(values[key]))
}

export function templateCases(directory) {
  const template = readFileSync(path.join(directory, 'template.html'), 'utf8')
  const data = JSON.parse(readFileSync(path.join(directory, 'data.json'), 'utf8'))

  return data.entries.map((entry) => ({
    id: entry.id,
    width: entry.width ?? data.width,
    height: entry.height ?? data.height,
    source: fill(template, entry),
  }))
}

export async function withRenderedPage(directory, entry, capture) {
  const input = path.join(directory, `.${entry.id}.html`)

  writeFileSync(input, entry.source, { flag: 'wx' })

  try {
    return await capture(input)
  } finally {
    rmSync(input)
  }
}
