# Rendering: PDF and Word

Pagehall turns pages into print-ready HTML on the server. By default, the person's own browser lays it out into sheets and saves it as PDF through its print dialog. Word documents are created by Pagehall itself. Neither needs anything besides Pagehall.

An optional render container creates PDF files on the server. It is needed only for:

- PDF through the API (`GET /api/v1/pages/{pageId}/export?format=pdf` and exports with `"format": "pdf"`),
- PDF of a page with many subpages or of a whole space in the background, for example above the 300 pages a browser prints reliably at once.

Without it, those requests answer with `renderUnavailable` ("Server-side PDF needs the render container; see the documentation"), and interactive export still works through the browser.

## How the print-ready HTML is laid out

The print-ready HTML (`format=print`) is plain HTML and CSS without scripts. It uses CSS Paged Media for the paper size and orientation, page breaks, the running header with the space and page path, the footer with "Page n of m" and the page numbers in the table of contents. Browsers do not lay out these rules themselves, so the print view and the render container both load it into the same viewer, `print.html` of the web client, which lays it out with [Vivliostyle](https://vivliostyle.org) (AGPL-3.0). The same HTML therefore gives the same sheets in the person's browser and in the render container.

The print view is tested in Chromium. Chrome and Edge take the paper size and orientation from the print view. Firefox and Safari show the same sheets, but their print dialogs use their own paper settings, so people choose the same paper size and orientation there and turn off the browser's headers and footers.

## Setting up the render container

The image `pagehall-render` (built from `docker/render.Dockerfile`) runs headless Chromium from Debian and a small service on port 3000. Add it next to Pagehall and give both the same token of at least 32 characters, for example from `openssl rand -hex 32`. Put the container only on an internal network that it shares with Pagehall: it then reaches neither the database nor the internet, and nothing but Pagehall reaches it.

```yaml
services:
  pagehall-render:
    image: ghcr.io/pagehall/render:latest
    restart: unless-stopped
    environment:
      RENDER_TOKEN: ${PAGEHALL_RENDER_TOKEN}
    security_opt:
      - seccomp=./chromium-seccomp.json
    networks: [render]

  pagehall:
    environment:
      PAGEHALL_RENDER_URL: http://pagehall-render:3000
      PAGEHALL_RENDER_TOKEN: ${PAGEHALL_RENDER_TOKEN}
    networks: [default, render]

networks:
  render:
    internal: true
```

Leave the database, Redis and storage on the `default` network only. `internal: true` gives the `render` network no route out, so the container cannot open connections to the internet either.

### Chromium's sandbox

Chromium runs with its own sandbox by default. The sandbox needs user namespaces, which container runtimes restrict:

- The host must allow unprivileged user namespaces. Debian allows them; on Ubuntu 23.10 and later, AppArmor restricts them, so set `kernel.apparmor_restrict_unprivileged_userns=0` with `sysctl` or give the container an AppArmor profile that allows them.
- Docker's default seccomp profile refuses the system calls that create user namespaces. Run the container with a seccomp profile that allows them, as in the example above. Start from Docker's default profile (`profiles/seccomp/default.json` in the Moby repository) and allow `clone`, `clone3`, `unshare` and `setns` without the `CAP_SYS_ADMIN` condition, or use the Chromium profile that Playwright publishes in its repository (`utils/docker/seccomp_profile.json`). Do not use `seccomp=unconfined` or `privileged: true`.
- Podman in rootless mode and Kubernetes with user namespaces enabled (`hostUsers: false`) allow the sandbox without further settings.

If Chromium cannot start with the sandbox, the container stops with the error "Chromium did not start" and this hint. `RENDER_CHROMIUM_SANDBOX=false` turns the sandbox off as an explicit exception; the container then logs a warning at every start, because a flaw in Chromium's image or font decoding could run code with the rights of the container. Keep the internal network in that case above all.

Restart Pagehall. Settings, Instance, Rendering shows whether the container answers, its version, its browser, the documents it renders at the same time and its limits. In development, start it with `docker compose -f docker/compose.dev.yml --profile render up -d render` and set `PAGEHALL_RENDER_URL=http://render:3000` and `PAGEHALL_RENDER_TOKEN` for the app.

Settings of the container:

| Variable | Default | Description |
| --- | --- | --- |
| `RENDER_TOKEN` or `RENDER_TOKEN_FILE` | required | Token that Pagehall sends as `Authorization: Bearer`, at least 32 characters. |
| `RENDER_PORT` | `3000` | Port of the service. |
| `RENDER_CONCURRENCY` | `2` | Documents rendered at the same time. Each needs about 300 MB of memory. |
| `RENDER_MAX_WAITING` | 10 per parallel document | Documents that may wait; further requests are refused with 503. |
| `RENDER_MAX_MEGABYTES` | `200` | Largest request, the HTML with its images, in MB. Larger requests are refused with 413. |
| `RENDER_TIMEOUT_SECONDS` | `300` | Longest time for one document; then it is stopped and refused with 504. |
| `RENDER_CHROMIUM_SANDBOX` | `true` | Chromium's own sandbox. `false` turns it off and logs a warning; see [Chromium's sandbox](#chromiums-sandbox). |

`GET /health` answers without a token for health checks. `GET /v1/info` and `POST /v1/pdf` need the token.

## Security

- Only Pagehall's API and worker talk to the container; it needs no access to anything else. Keep it on an internal network without a route out, away from the database, and do not publish its port.
- Chromium runs in its sandbox unless `RENDER_CHROMIUM_SANDBOX=false`.
- Every request carries the token, which the container compares in constant time.
- Pagehall sends the complete document: the print-ready HTML of what the exporting person may read, and the images they may read. The container serves only these and its own viewer to Chromium; every other request, including to the instance itself and to other hosts, is blocked, and host names do not resolve.
- No JavaScript of the document runs. The viewer parses the document without executing scripts and allows only its own scripts, the pagination library included, through its content security policy.
- Each document gets its own browser context, which is closed afterwards, and runs under the time and size limits above.

## Word

Word documents need no container. They contain headings, paragraphs, lists and task lists, tables with merged cells, code in the paragraph style "Code", callouts and decisions as framed boxes, embedded images that the exporting person may read, other attachments and pages as links, mentions, status and dates as text, a table of contents, and a header and footer with "Page n of m". Word fills in the table of contents when it updates the fields of the document; it asks for that when the document opens.

## Diagrams

Images of drawings, whiteboards and draw.io, Mermaid and PlantUML diagrams are created in the browser of the person who saves them and stored with the page; print, PDF and Word use these stored images. PlantUML therefore needs neither Java nor this container. See [diagrams.md](diagrams.md).

## External embeds

The same page also holds the embed allowlist: the external services whose content pages may show in a frame. See [embeds-and-blocks.md](embeds-and-blocks.md#the-allowlist) for the rules, the defaults and how organizations narrow the list.
