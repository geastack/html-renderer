# Contributing

Run `npm ci --ignore-scripts` to install development dependencies. Use
`npm run format` to apply ESLint and Prettier fixes, then run
`npm run format:check` and `npm run check` before opening a pull request.

To build from source on macOS, put the GeaStack `cli`, `compiler`, `core`, and
`apple` checkouts beside this repository. See the publish workflow for the
revisions and build commands used in releases.

```sh
mkdir -p dist
npm run render -- fixtures/card.html --width 480 --height 220 --out dist/card.png
```

Pass `--reuse` for subsequent renders with that build. To exercise the worker
protocol directly, run `node scripts/render.mjs --serve` and send one capture request per
line as JSON.

GeaStack uses one contributor agreement for its repositories. The CLA check
will post instructions on your first pull request if you have not signed.
[Read the GeaStack CLA](https://github.com/geastack/.github/blob/main/CLA.md).

Rebase your changes onto the target branch before opening or updating a pull
request.
