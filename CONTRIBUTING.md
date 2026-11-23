# Contributing

Run `npm ci --ignore-scripts` to install development dependencies. Use
`npm run format` to apply ESLint and Prettier fixes, then run
`npm run format:check` and `npm run check` before opening a pull request.

To build from source, put the GeaStack `cli`, `compiler`, and `core` checkouts
beside this repository, plus the `apple`, `linux`, or `windows` checkout for the
host. The publish workflow lists the build dependencies and commands.

```sh
mkdir -p dist
npm run render -- fixtures/card.html --width 480 --height 220 --out dist/card.png
```

Pass `--reuse` for subsequent renders with that build. To exercise the worker
protocol directly, run `node scripts/render.mjs --serve` and send one JSON
request per line. To archive the native build and test the npm install flow,
run `node scripts/native-asset.mjs` followed by `npm run smoke:package`.

GeaStack uses one contributor agreement for its repositories. The CLA check
will post instructions on your first pull request if you have not signed.
[Read the GeaStack CLA](https://github.com/geastack/.github/blob/main/CLA.md).

Rebase your changes onto the target branch before opening or updating a pull
request.
