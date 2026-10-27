# Rendering

How print, PDF and Word exports are produced. Setting up the render container for operators is in [admin/rendering.md](../admin/rendering.md).

## Print-ready HTML

The server turns a page, a page with its subpages or a space into print-ready HTML (`format=print`). It is plain HTML and CSS without scripts. It uses CSS Paged Media for the paper size and orientation, page breaks, the running header with the space and page path, the footer with "Page n of m" and the page numbers in the table of contents.

Browsers do not lay out these rules themselves. The print view in the browser and the render container therefore both load the HTML into the same viewer, `apps/web/print.html` with `apps/web/src/print/viewer.ts`, which lays it out with [Vivliostyle](https://vivliostyle.org) (`@vivliostyle/core`, AGPL-3.0). The same HTML gives the same sheets in the person's browser and in the render container.

The print view is tested in Chromium. Chrome and Edge take the paper size and orientation from the print view. Firefox and Safari show the same sheets, but their print dialogs use their own paper settings, so people choose the same paper size and orientation there and turn off the browser's headers and footers.

A browser prints about 300 pages reliably at once (`MAX_BROWSER_PRINT_PAGES` in `packages/server/src/exports/options.ts`); larger PDF exports need the render container.

## The render container

`apps/render` is a small Node.js service, built with `docker/render.Dockerfile` into `ghcr.io/lunedo/render`. It drives Debian's Chromium through `playwright-core` and serves the built viewer from `RENDER_VIEWER_DIR` (`/app/viewer` in the image). `RENDER_BROWSER` is the path of the Chromium binary (`/usr/bin/chromium` in the image). The variables for operators are listed in [admin/rendering.md](../admin/rendering.md#settings-of-the-container).

### Protocol

| Route | Token | Answer |
|---|---|---|
| `GET /health` | no | `200` with `{ "status": "ok" }`. |
| `GET /v1/info` | yes | `version`, `browser`, `concurrency`, `running`, `waiting`, `maxBytes`, `timeoutSeconds`. |
| `POST /v1/pdf` | yes | The PDF. The body is JSON with `html`, `baseUrl` and `assets`, a list of `{ path, contentType, data }` with the data in Base64. |

Errors are JSON with `error`: `400` for a malformed body, `401` for a missing or wrong token, `413` for a body above `RENDER_MAX_MEGABYTES`, `503` when more documents wait than `RENDER_MAX_WAITING`, `504` after `RENDER_TIMEOUT_SECONDS`.

`RenderService` in `packages/server/src/exports/rendering.ts` is the client. Before every PDF it reads `/v1/info`, refuses documents whose estimated size is above `maxBytes` (`tooLarge`) and maps the answers to `unavailable`, `busy`, `tooLarge`, `timeout` and `failed`. The rendering page of the instance settings shows the result of `status()`: `notConfigured`, `healthy`, or `unreachable` with the reason `connection`, `token` or `response`.

### Isolation

`apps/render/src/chromium.ts` starts Chromium with `--host-resolver-rules=MAP * ~NOTFOUND` and without background networking. Each document gets its own browser context. Its requests are routed: the assets of the request are served from memory under the origin of `baseUrl` (the instance) or under `https://render.invalid`, the viewer files under `https://render.invalid`, `data:` and `blob:` pass, WebSockets are closed, and everything else is aborted and logged as `Blocked a request of a document` with the address without its query.

`print.html` gets a content security policy with `default-src 'none'` and `script-src 'self'`, so only the viewer's own scripts run; the document's HTML is parsed without executing scripts. Images may also come from the origin in `baseUrl`. The context is closed after the PDF or when the timeout aborts it.

The token is compared in constant time through SHA-256 digests.

## Word

`packages/server/src/exports/word.ts` builds `.docx` files with the `docx` library from the Word blocks of `@lunedo/editor-schema`. It needs no container.

## Development

Start the container from the development Compose file:

```sh
docker compose -f docker/compose.dev.yml --profile render up -d render
```

Set `LUNEDO_RENDER_URL=http://render:3000` and `LUNEDO_RENDER_TOKEN` (at least 32 characters) for the app; the `render` service reads the same `LUNEDO_RENDER_TOKEN`. Its port is published on `127.0.0.1:3003` (`RENDER_PORT`). Docker Desktop does not give containers the user namespaces Chromium's sandbox needs, so the development service sets `RENDER_CHROMIUM_SANDBOX=false` and logs a warning at start.
