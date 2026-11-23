// Renders every fixture, then renders fixtures/gallery.png: one page that
// shows the fixtures' images, laid out by use case. The gallery page itself
// is HTML rendered by the same renderer, at the highest DPR (up to 2) that
// stays within the 8192 px capture limit.
// Usage: node fixtures/shared/gallery.mjs

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openRenderer } from '../../lib/worker.mjs'
import { localExecutable } from '../../scripts/local-executable.mjs'

const shared = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(shared, '../..')

// Each fixture shows its first `pick` entries, or the listed entry ids.
const groups = [
  ['Basics', [['card'], ['promo']]],
  [
    'App share cards',
    [
      ['year-in-music'],
      ['now-playing'],
      ['run-card'],
      ['streak'],
      ['puzzle-result'],
      ['achievement'],
      ['activity-heatmap'],
      ['book-review'],
      ['quote-card'],
      ['recipe-card'],
      ['trip-recap'],
      ['sleep-summary'],
      ['savings-goal'],
      ['event-pass'],
      ['device-stats'],
    ],
  ],
  [
    'Event organisers',
    [
      ['speaker-card', 1],
      ['event-certificate', 1],
      ['attendee-badge', 3],
    ],
  ],
  ['Marketing', [['campaign', ['en-x', 'de-square', 'tr-story', 'fr-linkedin']]]],
  [
    'E-commerce',
    [
      ['sale-card', 3],
      ['price-label', 2],
    ],
  ],
  [
    'Courses and communities',
    [
      ['course-certificate', 1],
      ['member-badge', 3],
    ],
  ],
  ['Blogs and docs', [['blog-cover', 3]]],
  ['Sports', [['match-result', 2]]],
]

const pages = {
  card: { file: 'card/card.html', width: 480, height: 220 },
  promo: { file: 'promo/promo.html', width: 1200, height: 630 },
}

const width = 2400
const margin = 72
const content = width - margin * 2
const gutter = 24
const rowHeight = 340
const captionHeight = 40
const rowGap = 24

const local = localExecutable(root)
const renderer = openRenderer(existsSync(local) ? local : undefined)

async function images(name, pick = 1) {
  const out = path.join(root, 'dist', name)

  if (pages[name]) {
    const page = pages[name]
    const image = path.join(out, `${name}.png`)

    mkdirSync(out, { recursive: true })
    await renderer.capture({
      input: path.join(root, 'fixtures', page.file),
      out: image,
      width: page.width,
      height: page.height,
    })

    return [{ name, image, width: page.width, height: page.height }]
  }

  execFileSync(
    process.execPath,
    [path.join(shared, 'generate.mjs'), path.join(root, 'fixtures', name)],
    { stdio: 'ignore' },
  )

  const data = JSON.parse(readFileSync(path.join(root, 'fixtures', name, 'data.json'), 'utf8'))
  const entries = Array.isArray(pick)
    ? pick.map((id) => data.entries.find((entry) => entry.id === id))
    : data.entries.slice(0, pick)

  return entries.map((entry) => ({
    name,
    image: path.join(out, `${entry.id}.png`),
    width: entry.width ?? data.width,
    height: entry.height ?? data.height,
  }))
}

function ratio(list) {
  return list.reduce((sum, item) => sum + item.width / item.height, 0)
}

function fill(list) {
  return (content - gutter * (list.length - 1)) / ratio(list)
}

function sized(row, height) {
  return row.map((item) => ({ ...item, w: (item.width / item.height) * height, h: height }))
}

function rows(items) {
  const result = []
  let row = []

  for (const item of items) {
    const next = [...row, item]

    if (row.length && fill(next) < rowHeight) {
      result.push(sized(row, fill(row)))
      row = [item]
    } else {
      row = next
    }
  }

  if (row.length) {
    const natural = ratio(row) * rowHeight + gutter * (row.length - 1)

    result.push(sized(row, natural > content * 0.6 ? fill(row) : rowHeight))
  }

  return result
}

function tile(item, page) {
  const src = path.relative(path.dirname(page), item.image)
  const w = Math.floor(item.w)

  return `<div class="tile" style="width: ${w}px;"
    ><img class="shot" src="${src}" style="width: ${w}px; height: ${Math.floor(item.h)}px;"
    ><p class="caption">${item.name}</p
  ></div>`
}

try {
  const page = path.join(shared, '.gallery.html')
  let sections = ''
  let height = margin * 2 + 156
  let fixtures = 0
  let shown = 0

  for (const [title, list] of groups) {
    const items = []

    for (const [name, pick] of list) {
      items.push(...(await images(name, pick)))
      fixtures++
    }

    shown += items.length
    sections += `<div class="group"><p class="group-title">${title}</p>`
    height += 56 + 40

    for (const row of rows(items)) {
      sections += `<div class="row">${row.map((item) => tile(item, page)).join('')}</div>`
      height += rowGap + Math.floor(row[0].h) + captionHeight
    }

    sections += '</div>'
  }

  writeFileSync(
    page,
    `<!doctype html><html><head><title>Fixtures</title><link rel="stylesheet" href="gallery.css"></head><body><main class="gallery"><div class="header"><img class="logo" src="images/gea-logo.png"><div class="titles"><p class="title">html-renderer fixtures</p><p class="subtitle">${fixtures} fixtures, ${shown} of their images. Every image here, including this page, was rendered by the Gea HTML Renderer.</p></div></div>${sections}</main></body></html>`,
  )

  const dpr = Math.min(2, Math.floor((8192 / height) * 10) / 10)

  await renderer.capture({
    input: page,
    out: path.join(root, 'fixtures', 'gallery.png'),
    width: Math.round(width * dpr),
    height: Math.round(height * dpr),
    dpr,
  })
  rmSync(page)
  console.log(
    `fixtures/gallery.png: ${Math.round(width * dpr)} x ${Math.round(height * dpr)} at DPR ${dpr}`,
  )
} finally {
  await renderer.close()
}
