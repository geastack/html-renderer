# Gea HTML Renderer

Render local HTML and CSS to PNG with GeaStack's native macOS renderer.
The Node client keeps a native worker open for repeated captures.

## Install from npm

```sh
npm install @geastack/html-renderer
```

The [npm package](https://www.npmjs.com/package/@geastack/html-renderer)
includes the typed Node client and renderer source. It requires a compiled
macOS renderer executable. If you need to build one, see
[Build the native renderer](#build-the-native-renderer).

## Render a page

Set `GEA_HTML_RENDERER` to the executable inside the built macOS app bundle.
Save this example as `capture.mjs` and run `node capture.mjs` with a local
`page.html` in your working directory.

```js
import { openRenderer } from '@geastack/html-renderer'

const executable = process.env.GEA_HTML_RENDERER
if (!executable) throw new Error('Set GEA_HTML_RENDERER to the native executable path')

const renderer = openRenderer(executable)
try {
  await renderer.capture({
    input: './page.html',
    out: './page.png',
    width: 1920,
    height: 1080,
  })
} finally {
  await renderer.close()
}
```

Calls to `capture()` run in order. A failed capture rejects its promise and
the worker can handle the next request. Each capture reloads the document by
default. Set `reusePage: true` to capture the already mounted page again when
the input path, viewport, and DPR match.

## Build the native renderer

For this version, build from the source checkout on macOS with the GeaStack
`cli`, `compiler`, `core`, and `apple` repos beside it. Use the versions
that include native worker and runtime font support.

From the `html-renderer` checkout:

```sh
npm ci
mkdir -p dist
npm run render -- fixtures/card.html --width 480 --height 220 --out dist/card.png
export GEA_HTML_RENDERER="$PWD/dist/macos/html-renderer/Gea HTML Renderer.app/Contents/MacOS/Gea HTML Renderer"
```

The first render builds the executable. Pass `--reuse` on subsequent CLI
captures to use that build with a different input file or viewport size.

## Persistent worker protocol

For clients that need the wire protocol, send one JSON request per line.

```sh
node render.mjs --serve <<'JSON'
{"input":"fixtures/card.html","out":"dist/worker.png","width":480,"height":220}
{"input":"fixtures/card.html","out":"dist/recapture.png","width":480,"height":220,"reusePage":true}
JSON
```

Each request receives one JSON reply on stdout. Errors include an `error`
message. Diagnostics go to stderr. Close stdin to stop the worker.

## Supported input

The loader handles explicitly closed elements, void elements, text, common
named entities, local images, inline styles, style blocks, linked stylesheets,
and single-source local `@font-face` rules. HTML assets resolve relative to the
HTML file. Font paths resolve relative to their stylesheet. Rendering uses
Gea's selector, property, layout, and paint support. The prototype does not
execute page JavaScript, fetch remote assets, implement browser HTML error
recovery, or handle nested CSS at-rules.

## License

Apache-2.0. The bundled Barlow font is covered by its separate SIL Open Font
License. See `LICENSE` and `NOTICE`.
