# Development

## Repository layout

| Path | Contents |
|---|---|
| `apps/web` | Browser client: React, Vite, Tailwind CSS |
| `apps/api` | HTTP API: NestJS on Fastify, Drizzle ORM |
| `apps/collab` | Real-time collaboration server: Hocuspocus |
| `apps/worker` | Background jobs |
| `packages/editor-schema` | Document schema shared by client, server, importers and exporters |
| `packages/shared` | Types, validation and utilities; `@pagehall/shared/node` contains server-only code |
| `packages/ui` | Interface components |
| `packages/tokens` | Design tokens and the generated theme |
| `packages/config` | Shared TypeScript and Vitest configuration, development runner |
| `docker` | Container image and Compose files |
| `scripts` | Repository checks used in CI |

The workspace is managed with pnpm and Turborepo. The compiler is TypeScript 7 (`tsc`). typescript-eslint does not support its API yet, so the root package also installs TypeScript 6 under the name `typescript` for ESLint only; `@typescript/native` provides `tsc`. Packages are built to `dist` with `tsc`. Vite and Vitest read package sources directly through the `@pagehall/source` export condition, so changes in `packages/ui` or `packages/tokens` reach the web client without a rebuild.

## Development environment

`pnpm dev` runs `docker/compose.dev.yml`:

- `postgres`: PostgreSQL 16 on `localhost:5432`, user, password and database `pagehall`.
- `app`: installs dependencies inside the container and runs `pnpm dev:apps`, which starts every package's `dev` task through Turborepo.

The repository is mounted into the container. Dependencies live in Docker volumes, so the container never uses packages installed for the host system. File changes are detected by polling, because file system events do not reach containers through Windows bind mounts. The Node.js processes use `pagehall-dev` from `packages/config`, which rebuilds a package on changes and restarts its process; the web client uses Vite with polling.

The `app` service reports healthy when web, api, collab and worker answer; see `docker/dev-healthcheck.ts`.

To run everything on the host instead, start PostgreSQL, set `PAGEHALL_DATABASE_URL` and run `pnpm dev:apps`.

## Configuration

| Variable | Default | Used by |
|---|---|---|
| `PAGEHALL_DATABASE_URL` | required | api, collab, worker |
| `PAGEHALL_HOST` | `0.0.0.0` | api, collab, worker |
| `PAGEHALL_API_PORT` | `3000` | api |
| `PAGEHALL_COLLAB_PORT` | `3001` | collab |
| `PAGEHALL_WORKER_PORT` | `3002` | worker |
| `PAGEHALL_LOG_LEVEL` | `info` | api, collab, worker |
| `PAGEHALL_WEB_ROOT` | unset | api serves the built web client from this directory |

Every process exposes `GET /health/live` and `GET /health/ready`. Readiness includes a database check. Logs are JSON lines on stdout.

## Container image

`docker/Dockerfile` builds one image with all roles. The first argument selects the role:

```sh
docker build -f docker/Dockerfile -t pagehall .
docker run --rm -e PAGEHALL_DATABASE_URL=... -p 3000:3000 pagehall api
```

Roles are `api`, `collab`, `worker` and `all` (default), which runs all three processes in one container.

## Design tokens

`packages/tokens/src/design-tokens.json` is the single source for colors, type, spacing, radii and shadows. The build generates `packages/tokens/generated/theme.css`, which defines the Tailwind theme and the CSS variables for light and dark mode. The default Tailwind scales are removed, so only token values can be used in class names.

## Continuous integration

| Workflow | Trigger | Checks |
|---|---|---|
| `ci.yml` | pull requests, pushes to `main` | lint, typecheck, unit tests against PostgreSQL, Playwright, license check, dependency audit, DCO sign-off |
| `image.yml` | pushes to `main`, pull requests that change `docker/` | image build for amd64 and arm64, not published |
| `audit.yml` | Mondays 05:00 UTC, manual | `pnpm audit` on `main`; fails on any known vulnerability and lists the findings in the job summary |

Dependabot proposes dependency updates weekly (`.github/dependabot.yml`).
