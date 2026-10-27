# Rendering: PDF and Word

Checked against Docker, Ubuntu and Podman documentation, October 2026.

Lunedo turns pages into print-ready HTML on the server. By default, the person's own browser lays it out into sheets and saves it as PDF through its print dialog. Word documents are created by Lunedo itself. Neither needs anything besides Lunedo.

An optional render container creates PDF files on the server. It is needed only for:

- PDF through the API (`GET /api/v1/pages/{pageId}/export?format=pdf` and exports with `"format": "pdf"`),
- PDF of a page with many subpages or of a whole space in the background, for example above the 300 pages a browser prints reliably at once.

Without it, those requests answer with the problem `renderUnavailable`, and interactive export still works through the browser.

**Settings › Instance › Services › Rendering** shows whether the container is set up and answers. While it is not set up, the page shows Compose entries to copy, with the image version that matches the running release. They are the minimal form of the example below, without the seccomp profile and the internal network.

## Setting up the render container

The image `ghcr.io/lunedo/render` runs headless Chromium from Debian and a small service on port 3000. Use the same version as Lunedo.

1. Create a token of at least 32 characters, for example with `openssl rand -hex 32`, and put it into `.env` as `LUNEDO_RENDER_TOKEN`.
2. Save a seccomp profile for Chromium next to the Compose file as `chromium-seccomp.json`; see [Chromium's sandbox](#chromiums-sandbox).
3. Add the container to the Compose file and give Lunedo its address and the same token. Put the container only on an internal network that it shares with Lunedo:

   ```yaml
   services:
     lunedo-render:
       image: ghcr.io/lunedo/render:1.4.2
       restart: unless-stopped
       environment:
         RENDER_TOKEN: ${LUNEDO_RENDER_TOKEN}
       security_opt:
         - seccomp=./chromium-seccomp.json
       networks: [render]

     lunedo:
       environment:
         LUNEDO_RENDER_URL: http://lunedo-render:3000
         LUNEDO_RENDER_TOKEN: ${LUNEDO_RENDER_TOKEN}
       networks: [default, render]

   networks:
     render:
       internal: true
   ```

   Replace `1.4.2` with the running version. Leave the database, Valkey and storage on the `default` network only. `internal: true` gives the `render` network no route out, so the container reaches neither the database nor the internet, and nothing but Lunedo reaches it.

4. Start the container and restart Lunedo: `docker compose up -d`.
5. Open **Settings › Instance › Services › Rendering**. It shows **Healthy** with the container's version, its browser, the documents it renders at the same time and its limits per document.

`LUNEDO_RENDER_URL` is an `http://` or `https://` address without a path. `LUNEDO_RENDER_TOKEN` has at least 32 characters. See [configuration.md](configuration.md) for both.

## Chromium's sandbox

Chromium runs with its own sandbox by default. The sandbox needs user namespaces, which container runtimes restrict:

- The host must allow unprivileged user namespaces. Debian allows them. Ubuntu 23.10 and later can restrict them through AppArmor: when `kernel.apparmor_restrict_unprivileged_userns` is `1`, set it to `0` with `sysctl` or give the container an AppArmor profile that allows user namespaces.
- Docker's default seccomp profile refuses the system calls that create user namespaces. Run the container with a seccomp profile that allows them, as in the example above. Start from Docker's default profile (`seccomp/default.json` in the `moby/profiles` repository) and allow `clone`, `clone3`, `unshare` and `setns` without the `CAP_SYS_ADMIN` condition, or use the Chromium profile that Playwright publishes in its repository (`utils/docker/seccomp_profile.json`). Do not use `seccomp=unconfined` or `privileged: true`.
- Podman's default seccomp profile allows these system calls. On Kubernetes, give the pod a seccomp profile that allows them, as for Docker.

If Chromium cannot start with the sandbox, the container stops and logs `Chromium did not start` with a hint to this section. `RENDER_CHROMIUM_SANDBOX=false` turns the sandbox off as an explicit exception. The container then logs a warning at every start, because a flaw in Chromium's image or font decoding could run code with the rights of the container. In that case, keeping the container on the internal network matters above all.

## Settings of the container

| Variable | Default | Range | Description |
|---|---|---|---|
| `RENDER_TOKEN` | required | at least 32 characters | Token that Lunedo sends as `Authorization: Bearer`. Must equal `LUNEDO_RENDER_TOKEN`. |
| `RENDER_TOKEN_FILE` | none | | Path of a file with the token, for example a Docker secret. When set, it takes precedence over `RENDER_TOKEN`. |
| `RENDER_HOST` | `0.0.0.0` | | Address the service listens on. |
| `RENDER_PORT` | `3000` | 1–65535 | Port of the service. |
| `RENDER_CONCURRENCY` | `2` | 1–16 | Documents rendered at the same time. Each needs about 300 MB of memory. |
| `RENDER_MAX_WAITING` | 10 × `RENDER_CONCURRENCY` | 0–1000 | Documents that may wait; further requests are refused with `503`. |
| `RENDER_MAX_MEGABYTES` | `200` | 1–2048 | Largest request, the HTML with its images, in MiB. Larger requests are refused with `413`. |
| `RENDER_TIMEOUT_SECONDS` | `300` | 5–3600 | Longest time for one document; then it is stopped and refused with `504`. |
| `RENDER_CHROMIUM_SANDBOX` | `true` | `true` or `false` | Chromium's own sandbox. `false` turns it off and logs a warning; see [Chromium's sandbox](#chromiums-sandbox). |

A value outside its range stops the container with a message that names the variable and the range.

`GET /health` answers without a token, for health checks; the image uses it for its own health check. `GET /v1/info` and `POST /v1/pdf` need the token.

## Status on the rendering page

| State | Meaning | What to do |
|---|---|---|
| **Not configured** | `LUNEDO_RENDER_URL` is not set. | Nothing, if browser printing is enough. Otherwise set up the container as above. |
| **Healthy** | The container answers with the right token. | Nothing. |
| **Unreachable**, reason `connection` | Lunedo cannot connect to the container. Check that it runs and that LUNEDO_RENDER_URL points to it. | Check `docker compose ps`, the container's log, the address and that both containers share the `render` network. |
| **Unreachable**, reason `token` | The container refuses the token. Set the same token in LUNEDO_RENDER_TOKEN of Lunedo and RENDER_TOKEN of the container. | Set the same token on both sides and restart both. |
| **Unreachable**, reason `response` | The container answers, but not like a Lunedo render container. Check LUNEDO_RENDER_URL. | Make sure the address points to the render container, not to another service. |

**Check again** checks the container at once.

## Security

- Only Lunedo talks to the container; it needs no access to anything else. Keep it on an internal network without a route out, away from the database, and do not publish its port.
- Chromium runs in its sandbox unless `RENDER_CHROMIUM_SANDBOX=false`.
- Every request carries the token, which the container compares in constant time.
- Lunedo sends the complete document: the print-ready HTML of what the exporting person may read, and the images they may read. The container serves only these and its own viewer to Chromium. Every other request, also to the instance itself and to other hosts, is blocked, and host names do not resolve.
- No JavaScript of the document runs. The viewer parses the document without executing its scripts and allows only its own scripts through its content security policy.
- Each document gets its own browser context, which is closed afterwards, and runs under the time and size limits above.

## Word

Word documents need no container. They contain headings, paragraphs, lists and task lists, tables with merged cells, code in the paragraph style "Code", callouts and decisions as framed boxes, embedded images that the exporting person may read, other attachments and pages as links, mentions, status and dates as text, a header and a footer with "Page n of m", and, when asked for, a table of contents. Word fills in the table of contents when it updates the fields of the document; it asks for that when the document opens.

## Diagrams

Images of drawings, whiteboards and draw.io, Mermaid and PlantUML diagrams are created in the browser of the person who saves them and stored with the page. Print, PDF and Word use these stored images. PlantUML therefore needs neither Java nor the render container. See [diagrams.md](diagrams.md).

## External embeds

The services whose content pages may show in a frame are set under **Settings › Instance › Services › External embeds**; see [embeds.md](embeds.md).
