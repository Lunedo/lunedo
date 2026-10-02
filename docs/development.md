# Development

## Repository layout

| Path | Contents |
|---|---|
| `apps/web` | Browser client: React, Vite, Tailwind CSS |
| `apps/api` | HTTP API: NestJS on Fastify, Drizzle ORM |
| `apps/collab` | Real-time collaboration server: Hocuspocus |
| `apps/worker` | Background jobs |
| `packages/editor-schema` | Document schema shared by client, server, importers and exporters |
| `packages/shared` | Types, validation and utilities for client and server |
| `packages/server` | Server foundation: configuration, database, encryption, settings, jobs, observability, backups |
| `packages/ui` | Interface components |
| `packages/tokens` | Design tokens and the generated theme |
| `packages/config` | Shared TypeScript and Vitest configuration, development runner |
| `docker` | Container image and Compose files |
| `scripts` | Repository checks used in CI |

The workspace is managed with pnpm and Turborepo. The compiler is TypeScript 7 (`tsc`). typescript-eslint does not support its API yet, so the root package also installs TypeScript 6 under the name `typescript` for ESLint only; `@typescript/native` provides `tsc`. Packages are built to `dist` with `tsc`. Vite and Vitest read package sources directly through the `@pagehall/source` export condition, so changes in `packages/ui` or `packages/tokens` reach the web client without a rebuild.

## Development environment

`pnpm dev` runs `docker/compose.dev.yml`:

- `postgres`: PostgreSQL 16 on `localhost:5432`, user, password and database `pagehall`.
- `mailpit`: catches all outgoing e-mail. SMTP on `localhost:1025`, web interface on `http://localhost:8025`. See [email.md](email.md).
- `app`: installs dependencies inside the container and runs `pnpm dev:apps`, which starts every package's `dev` task through Turborepo.

The repository is mounted into the container. Dependencies live in Docker volumes, so the container never uses packages installed for the host system. File changes are detected by polling, because file system events do not reach containers through Windows bind mounts. The Node.js processes use `pagehall-dev` from `packages/config`, which rebuilds a package on changes and restarts its process; the web client uses Vite with polling.

The `app` service reports healthy when web, api, collab and worker answer; see `docker/dev-healthcheck.ts`.

Dependencies are installed when the `app` container starts. After pulling changes that add or update dependencies, restart it with `docker compose -f docker/compose.dev.yml restart app`.

### Resetting the development data

`pnpm dev:reset` deletes all development data and asks for confirmation first; type `reset` to continue. It stops and removes the `app` container, drops the development database `pagehall` and every database left behind by tests (`pagehall_*test_*`, `pagehall_e2e_*`), creates an empty development database and removes the `pagehall-data` volume with the development secrets (master keys, backup keys, metrics token) and files. Start again with `pnpm dev`; the instance then asks for setup and prints a new setup code in the log of the `app` container.

To run everything on the host instead, start PostgreSQL, set `PAGEHALL_DATABASE_URL` and run `pnpm dev:apps`.

## Operations

All settings are described in [configuration.md](configuration.md). The database conventions are in [database.md](database.md), encryption and key rotation in [encryption.md](encryption.md), backups in [backup.md](backup.md). Setup is described in [setup.md](setup.md), sign-in and sessions in [authentication.md](authentication.md), the audit log in [audit.md](audit.md) and e-mail in [email.md](email.md).

Every process exposes `GET /health/live`, `GET /health/ready` and `GET /metrics`. Readiness covers the database, the migration state and the master key; metrics require the metrics token. Logs are JSON lines on stdout and carry the request ID, also in jobs enqueued by a request.

Every API route declares how it may be accessed (`@PublicRoute()`, `@MetricsTokenRoute()`, `@SessionRoute()`, `@SetupCodeRoute()`, `@SetupSessionRoute()`, or `@Permission(action, resource)` for routes that act on instance or organization resources, see [organizations.md](organizations.md)); the API refuses to start when a route has none, and the global guard rejects such routes as well. Routes that only the web client uses are marked with `@InternalRoute()`.

## Container image

`docker/Dockerfile` builds one image with all roles. The first argument selects the role:

```sh
docker build -f docker/Dockerfile -t pagehall .
docker run --rm -e PAGEHALL_DATABASE_URL=... -p 3000:3000 pagehall api
```

Roles are `api`, `collab`, `worker` and `all` (default), which runs all three processes in one container.

## Design tokens

`packages/tokens/src/design-tokens.json` is the single source for colors, type, spacing, radii and shadows. The build generates `packages/tokens/generated/theme.css`, which defines the Tailwind theme and the CSS variables for light and dark mode. The default Tailwind scales are removed, so only token values can be used in class names. The web client is described in [web-client.md](web-client.md).

## Interface patterns

Screens are built from the components in `packages/ui`; `/dev/components` shows each of them in every state. New screens follow these rules, so that the interface behaves the same everywhere.

### Choosing from many options

| Options | Component |
|---|---|
| Up to 4 fixed options | `SegmentedControl` |
| 5 to 10 fixed options | `Select` |
| More than 10 options, or options that come from data (people, groups, organizations, roles, time zones, languages) | `Combobox`, which searches as you type, is operated with the arrow keys, Home, End, Enter and Escape, and says when nothing matches |
| Several values | `Combobox` with `multiple`, which shows the chosen values as removable chips |

- Data that can be large, such as accounts or groups, is searched on the server: pass `load(query, cursor)` instead of `items`. The combobox debounces the input, shows the newest answer only and offers "Load more" while a next cursor exists.
- Time zones use `TimeZoneCombobox`. It matches city, region and offset, shows the current offset and local time of each zone, and lists the inherited and the browser's time zone first.
- The list of every select and combobox is at least as wide as its trigger.

### Settings

- Every setting is one `SettingRow` with three columns: label, description and source line on the left; exactly one control in a fixed-width column; the "…" menu (`menu`) in a fixed column on the right, also when a row has no menu.
- Choices use `SettingSelect`. Options list the concrete values once, with an example where it helps, such as "24-hour (14:30)". The option equal to the inherited value carries a "Default" marker. While the setting is inherited, that option is selected and the control is muted; choosing it later follows the default again, choosing another option overrides it. Resetting to the default and locking stay in the "…" menu.
- Durations use `DurationSelect`: the common values of the setting, plus "Custom…", which opens a small popover with a number and a unit. Values are always shown as readable durations.

### Page layout

- Pages that are mainly a table or list use `PageContainer` with `width="wide"` and fill the content area. Pages that are mainly a form or settings use `width="narrow"`.
- A table page has one `TableToolbar` above the table: search, filters and "Reset filters" on the left, actions such as export on the right.
- Clicking a table row, or pressing Enter on it, opens the object (`onRowClick` with `rowLabel`). Clicks on buttons, links and menus inside a row do not open it; the "…" menu holds secondary actions only.
- Access levels per area use `ChoiceTable`: the area and its explanation on the left, a `SegmentedControl` in one aligned column on the right. Options a person may not choose stay visible, disabled, with a tooltip that says why (`disabledReason`).

## Continuous integration

| Workflow | Trigger | Checks |
|---|---|---|
| `ci.yml` | pull requests, pushes to `main` | lint, translation check, typecheck, unit tests against PostgreSQL, end-to-end tests with accessibility checks and screenshots, backup round trip with the image, license check, dependency audit, DCO sign-off |
| `image.yml` | pushes to `main`, pull requests that change `docker/` | image build for amd64 and arm64, not published |
| `audit.yml` | Mondays 05:00 UTC, manual | `pnpm audit` on `main`; fails on any known vulnerability and lists the findings in the job summary |

Dependabot proposes dependency updates weekly (`.github/dependabot.yml`).
