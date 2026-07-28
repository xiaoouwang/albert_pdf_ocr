# Albert OCR — GitHub Pages

GitHub Pages can only host **static** files. Albert API does **not** send CORS
headers, so a browser page on `*.github.io` cannot call
`https://albert.api.etalab.gouv.fr` directly.

## Fix: static site + free CORS proxy

```text
Browser (GitHub Pages)  →  Cloudflare Worker (CORS)  →  Albert API
```

The API key stays in the user’s browser. The Worker only forwards the request.

### 1. Deploy the Worker (once, free)

From this `web/` folder:

```bash
npm i -g wrangler
wrangler login
wrangler deploy
```

Copy the URL printed by Wrangler, e.g.
`https://albert-ocr-proxy.<subdomain>.workers.dev`

### 2. Point the UI at the Worker

Edit `config.js`:

```js
window.ALBERT_OCR_CONFIG = {
  proxyUrl: "https://albert-ocr-proxy.<subdomain>.workers.dev",
};
```

### 3. Publish on GitHub Pages

1. Push the `web/` contents to a repo (root, or `/docs`, or `gh-pages` branch).
2. Settings → Pages → deploy from that folder/branch.
3. Add an empty `.nojekyll` file (already included) so Pages serves assets as-is.

For a project site (`https://USER.github.io/REPO/`), put `web/` files at the
repo root or enable Pages from `/docs` after copying them there.

### Local development (no Cloudflare)

```bash
python3 server.py
# open http://127.0.0.1:8765/
```

Leave `proxyUrl` empty: the UI uses the local `/proxy/...` route.

## Longer-term fix

Ask the Albert API maintainers to add CORS headers on
`/v1/chat/completions` (e.g. allow browser origins). Then GitHub Pages alone
would be enough and the Worker would become optional.
