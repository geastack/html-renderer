# Gea HTML Renderer

A macOS prototype that loads local HTML as a Gea document. One TypeScript
application builds the node tree at runtime, and Gea's existing software
renderer lays it out and captures a PNG.

This prototype uses the sibling `cli`, `compiler`, `core`, and `apple`
checkouts in the GeaStack workspace. The Apple checkout must have runtime
font registration enabled. The sample includes its Barlow font and license.

```sh
npm ci
npm run check
mkdir -p dist
npm run render -- fixtures/card.html --width 480 --height 220 --out dist/card.png
npm run render -- fixtures/card.html --reuse --width 600 --height 220 --out dist/wide.png
```

The first command that renders builds the loader. With `--reuse`, different
HTML files and viewport sizes can use the same executable. Asset paths in
HTML are relative to the HTML file. Font paths in CSS are relative to their
stylesheet.

The loader handles explicitly closed elements, void elements, text, common
named entities, local images, inline styles, style blocks, linked
stylesheets, and single-source local `@font-face` rules. It uses Gea's own
selector, property, layout, and paint support. Browser HTML error recovery,
JavaScript, remote assets, and nested CSS at-rules are outside this
prototype's input profile.

## Persistent worker

Build the renderer once using the first command above. Then send one JSON
request per line to the native renderer through the wrapper.

```sh
node render.mjs --serve <<'JSON'
{"input":"fixtures/card.html","out":"dist/worker.png","width":480,"height":220}
{"input":"fixtures/card.html","out":"dist/recapture.png","width":480,"height":220,"reusePage":true}
JSON
```

Each request returns one JSON reply on stdout. Errors include an `error`
message and leave the worker available for later requests. Diagnostics go
to stderr. Close stdin to stop the worker.

By default each request loads the HTML and assets again into a fresh Gea
tree. The process, framebuffer allocation, and matching font caches can
survive across requests. Set `reusePage` to capture the currently mounted
static page again when the input path, viewport, and DPR match. This skips
reloading the files. Request a normal capture to pick up edits.

## Node API

The npm package exposes a typed worker client. Supply the macOS executable
built from this repository.

```js
import { openRenderer } from '@geastack/html-renderer'

const renderer = openRenderer('/absolute/path/to/Gea HTML Renderer')
try {
  const result = await renderer.capture({
    input: '/absolute/path/to/page.html',
    out: '/absolute/path/to/page.png',
    width: 480,
    height: 220,
  })
  console.log(result.ms)
} finally {
  await renderer.close()
}
```

Calls to `capture()` are handled in order. A failed capture rejects its
promise and leaves the worker available for the next request.

## License

Apache-2.0. The bundled Barlow font is covered by its separate SIL Open Font
License. See `LICENSE` and `NOTICE`.
