import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { escapeHtml } from '../fixtures/shared/templates.mjs'

function figure(file, label) {
  if (!file) {
    return '<p>Image unavailable</p>'
  }

  const url = file.split(path.sep).map(encodeURIComponent).join('/')

  return `<figure><figcaption>${label}</figcaption><a href="${url}"><img src="${url}" loading="lazy" alt="${label}"></a></figure>`
}

export function writeReport(output, metadata, results) {
  const fixtures = new Map()

  for (const result of results) {
    if (!fixtures.has(result.fixture)) {
      fixtures.set(result.fixture, [])
    }

    fixtures.get(result.fixture).push(result)
  }

  const exact = results.filter((result) => result.changed === 0).length
  const failures = results.filter((result) => result.changed === undefined).length
  const percent = (result) => ((100 * result.changed) / result.pixels).toFixed(3) + '%'
  const sections = Array.from(fixtures, ([name, entries]) => {
    const cards = entries.map((result) => {
      const error = [result.geaError, result.chromiumError, result.diffError]
        .filter(Boolean)
        .join('\n')
      const stats =
        result.changed === undefined
          ? 'Comparison unavailable'
          : `${result.changed.toLocaleString('en-US')} of ${result.pixels.toLocaleString('en-US')} pixels differ (${percent(result)}). Maximum channel difference ${result.maxDelta}/255.`

      return `<article><h3>${escapeHtml(result.id)} · ${result.width} × ${result.height}</h3>
<p>${stats}</p>${error ? `<pre>${escapeHtml(error)}</pre>` : ''}
<div class="images">${figure(result.gea, 'Gea')}${figure(result.chromium, 'Chromium')}${figure(result.diff, 'Pixel diff')}</div></article>`
    })

    return `<section id="${escapeHtml(name)}"><h2>${escapeHtml(name)}</h2>${cards.join('\n')}</section>`
  })

  const links = Array.from(fixtures, ([name, entries]) => {
    const measured = entries.filter((result) => result.changed !== undefined)
    const total = measured.reduce((sum, result) => sum + result.pixels, 0)
    const changed = measured.reduce((sum, result) => sum + result.changed, 0)
    const delta = total ? percent({ pixels: total, changed }) : 'unavailable'

    return `<li><a href="#${escapeHtml(name)}">${escapeHtml(name)}</a> · ${entries.length} · ${delta}</li>`
  })

  writeFileSync(
    path.join(output, 'results.json'),
    JSON.stringify({ metadata, results }, null, 2) + '\n',
  )
  writeFileSync(
    path.join(output, 'index.html'),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gea and Chromium visual comparison</title><style>
body{max-width:1500px;margin:40px auto;padding:0 24px;font:16px/1.5 system-ui;color:#17212b;background:#f5f7fa}
article{margin:16px 0;padding:16px;background:white;border:1px solid #dce3eb;border-radius:8px}
h2,h3,p{margin:0 0 8px}h2{margin-top:32px}a{color:#174ea6}
nav ul{columns:3;padding-left:24px}.images{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
figure{margin:0}img{display:block;width:100%;height:auto;margin-top:4px;background:#e9edf3}pre{white-space:pre-wrap}
@media(max-width:700px){nav ul{columns:1}.images{grid-template-columns:1fr}}
</style></head><body>
<h1>Gea and Chromium visual comparison</h1>
<p>${fixtures.size} fixtures · ${results.length} cases · ${exact} pixel-identical · ${failures} capture or comparison errors</p>
<p>Chromium ${escapeHtml(metadata.chromium)} · ${escapeHtml(metadata.host)}</p>
<p>Magenta marks any RGBA difference, including antialiasing. Select an image to open it at full resolution. <a href="results.json">Raw measurements</a></p>
<nav aria-label="Fixtures"><ul>${links.join('\n')}</ul></nav>
${sections.join('\n')}
</body></html>`,
  )
}
