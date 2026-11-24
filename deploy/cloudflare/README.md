# Deploy Gea HTML Renderer to Cloudflare

The Lite service renders uploaded HTML, CSS, images, and fonts as a
1920 × 1080 PNG. The image starts one Gea executable. Geatsc compiles the
TypeScript HTTP server and HTML renderer together. The final image uses
`scratch` with the executable and its shared libraries.

## Deploy

Use the [Deploy to Cloudflare button](https://deploy.workers.cloudflare.com/?url=https://github.com/geastack/html-renderer)
to import the repository and deploy through Workers Builds. Enable Containers
on your account and enter a strong, unique value for the Worker secret
`RENDER_TOKEN` when prompted. You can also set it under the Worker’s
**Settings → Variables and Secrets**.

For a local deployment, install Node.js 20.19 or later and start Docker on macOS or Linux.
Authenticate Wrangler to a Cloudflare account with Containers enabled and
set `RENDER_TOKEN` in your shell. Run this from the HTML Renderer repository
root:

```sh
npm run cloudflare:deploy
```

Both deployment paths download the versioned image from the renderer's
public GitHub release. Wrangler imports its filesystem into the deploying
account's Cloudflare registry and deploys the Worker.

Use `-- --dry-run` to validate locally. To build the Linux executable
from source on macOS or Linux, run
`bash deploy/cloudflare/scripts/build-in-docker.sh`.

## Render a page

Send a ZIP with `index.html` at its root. Reference CSS, images, and fonts
with paths relative to the file that loads them.

```sh
curl --fail-with-body "$RENDER_URL/render" \
  -H "Authorization: Bearer $RENDER_TOKEN" \
  -H "Content-Type: application/zip" \
  --data-binary @page.zip -o page.png
```

For assets in one directory, send each file in a repeated `files` field.
Reference the assets by filename from the HTML and CSS.

```sh
curl --fail-with-body "$RENDER_URL/render" \
  -H "Authorization: Bearer $RENDER_TOKEN" \
  -F files=@index.html -F files=@style.css -F files=@logo.png -o page.png
```

Uploads can contain up to 256 files and 8 MiB of request data. ZIP
entries can expand to a total of 24 MiB. Gea renders local assets inside
the bundle. The service retains the last encoded PNG for identical
uploads with the same compression preset.

HTTP responses default to `fast` PNG compression. Send
`X-Gea-Png-Compression: compact` for a smaller file, or `fast` to request
the default explicitly. Both presets produce lossless PNGs. The native Rust PNG
encoder uses its Fast setting for `fast` and Balanced for `compact`.

The [benchmark](benchmark/README.md) has its own configs and fixture
images. Use `GET /health` to check the renderer service.
