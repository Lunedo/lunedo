# Architecture

Lunedo consists of three server processes, an optional render container and a single-page web client. All server processes share the code in `packages/server` and one PostgreSQL database.

## Processes

| Process | Code | Port | Purpose |
|---|---|---|---|
| API | `apps/api` | 3000 | HTTP API, the built web client, the API reference at `/api/docs`, server-sent events for live updates, and the forwarding of `/collab` to the collaboration server. |
| Collaboration server | `apps/collab` | 3001 | WebSocket server for shared editing of pages and whiteboards, see [collaboration.md](collaboration.md). |
| Worker | `apps/worker` | 3002 (health and metrics only) | Background jobs from the job queue. The command line tools of the image are part of `apps/worker` as well. |
| Render container | `apps/render` | 3000 in its own container | Optional. Headless Chromium that turns print-ready HTML into PDF, see [rendering.md](rendering.md). |

The web client (`apps/web`) runs in the browser and uses only the HTTP API and the collaboration WebSocket; every decision about permissions is made by the server. See [web-client.md](web-client.md).

`packages/server` holds the domain modules (accounts, spaces, imports, search, backup and so on) and the foundation: configuration, database, encryption, settings, jobs, authorization, audit log and observability. `createServerRuntime` in `packages/server/src/runtime/runtime.ts` builds them for a role (`api`, `collab` or `worker`): it loads the configuration, applies pending migrations and connects to the job queue: the worker works off the jobs, the API only enqueues them, and the collaboration server does not use the queue. The worker learns of a new job at once through PostgreSQL `LISTEN`/`NOTIFY` and still polls every 2 seconds, which picks up retries and jobs with a later start. Search index updates and display versions of images run as many at a time as the process has CPUs, unless `LUNEDO_JOB_CONCURRENCY` sets another number per queue; display versions are fetched in batches of that size. Requests to update the search index or to look for new images carry no data, so the worker answers all waiting requests of such a queue with one run.

## Data

- **PostgreSQL** is the only required datastore. It holds all content, settings and the job queue (pg-boss in the schema `pgboss`). See [database.md](database.md).
- **File storage** holds attachments, exports and imports, on the local disk or in S3-compatible storage. See [storage.md](../admin/storage.md) and [encryption.md](encryption.md).
- **Redis** is optional and only used by the collaboration server when more than one collaboration node runs.

Processes and nodes tell each other about changes through PostgreSQL notifications (`LISTEN`/`NOTIFY`, `packages/server/src/database/notifications.ts`): changed settings, maintenance mode, changed documents, access changes in a space, audit events that affect permissions, new notifications and others. The API passes the changes that concern the web client on through the event stream `/api/v1/notifications/stream`, so screens update without polling.

## Route access

Every API route declares how it may be accessed, with one of these decorators from `apps/api/src/access/route-access.ts`:

| Decorator | Access |
|---|---|
| `@PublicRoute()` | Anyone. |
| `@SessionRoute()` | A signed-in session, optionally with a recent sign-in or during the setup of a second factor. |
| `@Permission(action, resource)` | A session or an API token whose principal holds the permission on the resource: the instance, an organization, a space, an item or another resource named by a route parameter. |
| `@MetricsTokenRoute()` | The metrics token. |
| `@SetupCodeRoute()`, `@SetupSessionRoute()` | The setup code, or the session of the setup assistant. |
| `@ScimTokenRoute()` | The SCIM token of an identity provider. |
| `@ApiDocumentationRoute()` | Signed-in people and API tokens, or anyone when the instance makes its API reference public. |

The API refuses to start when a route has none, and the global guard rejects such routes as well. Routes that only the web client uses are additionally marked with `@InternalRoute()` and left out of the API reference (see [api.md](api.md)). How permissions are resolved is in [authorization.md](authorization.md).

## Health, metrics and logs

Every process exposes `GET /health/live`, `GET /health/ready` and `GET /metrics` on its port. Readiness covers the database, the migration state and the master key; metrics require the metrics token. Logs are JSON lines on stdout and carry the request ID, also in jobs enqueued by a request. What operators see is in [monitoring.md](../admin/monitoring.md); settings are in [configuration.md](../admin/configuration.md).

## Container image

`docker/Dockerfile` builds one image with all roles. `scripts/bundle-server.ts` bundles the processes and the command line tools with esbuild; the image contains the bundles, the built web client and the packages in `docker/runtime`. The first argument selects the role:

```sh
docker build -f docker/Dockerfile -t lunedo .
docker run --rm -e LUNEDO_DATABASE_URL=... -p 3000:3000 lunedo api
```

Roles are `api`, `collab`, `worker` and `all` (default), which runs all three processes in one container. The other arguments run a command line tool: `backup`, `keys`, `audit`, `search`, `maintenance`, `version`, `release-notes` and `help` (`docker/start.sh`).

`docker/render.Dockerfile` builds the optional render container with Debian's Chromium, the service of `apps/render` and the print viewer of the web client.

## Design tokens

`packages/tokens/src/design-tokens.json` is the single source for colors, type, spacing, radii and shadows. The build generates `packages/tokens/generated/theme.css`, which defines the Tailwind theme and the CSS variables for light and dark mode. The default Tailwind scales are removed, so only token values can be used in class names. Components never use raw colors, sizes or shadows.
