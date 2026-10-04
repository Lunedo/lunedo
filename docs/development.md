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

### Identity providers for development and tests

Keycloak and Authentik run as OIDC providers with test users and groups, Keycloak also as SAML provider, and OpenLDAP as directory. They belong to the Compose profile `idp` and start only on request, because Authentik needs its own database and both take a minute to start:

```sh
pnpm dev:idp
```

`pnpm dev:down` stops them together with the rest of the environment.

| Provider | Issuer | Client ID | Client secret | Administration |
|---|---|---|---|---|
| Keycloak | `http://keycloak.localhost:8080/realms/pagehall` | `pagehall` | `pagehall-keycloak-secret` | `http://keycloak.localhost:8080/admin`, user `admin`, password `admin` |
| Authentik | `http://authentik.localhost:9000/application/o/pagehall/` | `pagehall` | `pagehall-authentik-secret` | `http://authentik.localhost:9000`, user `akadmin`, password `admin`, API token `pagehall-authentik-api-token` |

Browsers and the `app` container reach both providers under the same `*.localhost` address, so the issuer in tokens matches the issuer Pagehall discovers. Browsers resolve `*.localhost` to the local machine; the `app` container maps the two names to the host. Both providers accept redirect URIs on `http://localhost:3000`, `http://localhost:5173` and `http://localhost:4310` (end-to-end tests). They are set up from `docker/idp/keycloak/pagehall-realm.json` and the Authentik blueprint `docker/idp/authentik/pagehall.yaml` at start.

Test users, all with the password `pagehall-test-password`:

| User | E-mail | Groups |
|---|---|---|
| `alice` | `alice@example.org` | engineering, admins |
| `bob` | `bob@example.org` | engineering |
| `carol` | `carol@example.org` | none |
| `dave` | `dave@example.org` | engineering; tests disable this account |
| `erin` | `erin@example.net` | none; e-mail outside the configured domain `example.org` |

Both providers send the stable group IDs in the `groups` claim and the group names in `group_names`. Keycloak sends them without an extra scope, Authentik with the scope `groups`. In Keycloak the IDs are fixed in the realm (`engineering` is `6f1c2b8e-3a4d-4c5e-9f60-7a8b9c0d1e2f`, `admins` is `0b9a8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d`); in Authentik they are created at the first start and can be looked up by the group attribute `pagehall_test_group`.

Back-channel logout goes to the URL in `PAGEHALL_KEYCLOAK_BACKCHANNEL_LOGOUT_URL` and `PAGEHALL_AUTHENTIK_BACKCHANNEL_LOGOUT_URL` when the providers start; tests set it through the administration interfaces. The providers reach Pagehall on the host as `host.docker.internal`.

`apps/web/e2e/support/idp.ts` drives both providers in end-to-end tests: it signs in through their login forms, disables and enables users, changes group memberships and group names, sets the back-channel logout URL and restores the initial state. The tests in `apps/web/e2e/idp` run when `PAGEHALL_E2E_IDP=1` is set, for example `PAGEHALL_E2E_IDP=1 pnpm --filter @pagehall/web exec playwright test --project=idp`.

Keycloak also serves as SAML identity provider. Its metadata is at `http://keycloak.localhost:8080/realms/pagehall/protocol/saml/descriptor`. The SAML client is not part of the realm, because its entity ID contains the ID of the Pagehall provider: the end-to-end tests create the provider, load Pagehall's service provider metadata from `/api/v1/auth/providers/{id}/saml/metadata` and register it through the Keycloak administration API. To try SAML by hand, import the same metadata under Clients, Import client in the Keycloak administration, turn on "Force POST binding" and add the mappers `email` (user property) and `groups` (group list, without full path).

OpenLDAP runs in the same profile on `ldap://localhost:3389` (`ldap://openldap:389` from the `app` container), built from `docker/idp/openldap` with the base `dc=example,dc=org`. Pagehall connects with the service account `cn=pagehall,ou=service,dc=example,dc=org` and the password `pagehall-ldap-service-password`; the administrator is `cn=admin,dc=example,dc=org` with the password `admin`. The plain connection works only because the development environment sets `PAGEHALL_INSECURE_IDENTITY_PROVIDERS`. People live under `ou=people`, groups under `ou=groups`, and the user filter is the default `(objectClass=inetOrgPerson)`:

| User | E-mail | Groups |
|---|---|---|
| `lena` | `lena@directory.example.org` | staff, platform, and engineering through platform |
| `max` | `max@directory.example.org` | staff, platform, and engineering through platform |
| `nora` | `nora@directory.example.org` | staff; tests disable this account |
| `otto` | `otto@directory.example.org` | none; disabled through `employeeType: disabled` |

All of them have the password `pagehall-test-password`. Active Directory specifics (the nested group matching rule, `userAccountControl`, `accountExpires` and the sub-codes of failed binds) are tested against a fake directory in `packages/server/src/testing/fakes/ldap-directory.ts`, which evaluates real LDAP filters.

Microsoft Graph and the Google Directory API are replaced in tests by small local fakes in `packages/server/src/testing/fakes`, exported from `@pagehall/server/testing`. `startFakeGraph()` and `startFakeGoogleDirectory()` start them on a free port inside a test; `node --import ./packages/server/src/testing/ts-resolve.mjs packages/server/src/testing/fakes/serve.ts` runs both as a process on ports 4320 and 4321 (`PAGEHALL_FAKE_GRAPH_PORT`, `PAGEHALL_FAKE_GOOGLE_PORT`). They issue application tokens (client credentials for Graph, a service account assertion for Google), page their results like the real APIs (`@odata.nextLink`, `nextPageToken`) and contain a person with 250 groups for the Entra ID group overage, nested groups, a disabled and a suspended account. Tests change their data directly or through `/_fake/...` requests.

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
| `ci.yml` | pull requests, pushes to `main`, manual | see below |
| `image.yml` | pushes to `main`, release tags `v*`, manual | image build for amd64 and arm64, not published |
| `api.yml` | pull requests | compares the API description with the base branch |
| `audit.yml` | Mondays 05:00 UTC, manual | `pnpm audit` on `main`; fails on any known vulnerability and lists the findings in the job summary |

`ci.yml` has two lanes. A newer push to the same pull request or branch cancels the running workflow.

- Fast lane, for draft pull requests: lint, reference and translation checks, typecheck, script tests, unit tests of the packages affected since the base branch (Turborepo `--affected`, split into three shards against PostgreSQL), license check, dependency audit, DCO sign-off.
- Full lane, when a pull request is ready for review, on every push to it, on `main` and on manual runs: the fast lane with all unit tests, plus the expensive jobs below. On a pull request they run only when their area changed; changes to workflows or shared dependencies (`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json`, `.nvmrc`, `packages/config/`) run all of them, and `main` always runs all of them.

| Job | Runs on pull requests when these change |
|---|---|
| End-to-end, accessibility and visual tests | `apps/web/`, `packages/ui/`, `packages/tokens/` |
| Sign-in through identity providers | identity, authentication and sign-in code in server, API and web client including SAML and LDAP, the shared provider configuration, `apps/web/e2e/idp/`, the end-to-end setup, `docker/idp/`, `docker/compose.dev.yml` |
| Backup round trip (builds the image for amd64 only) | `packages/server/src/backup/`, `packages/server/drizzle/`, `apps/worker/src/cli/`, `docker/`, `scripts/backup-roundtrip.sh` |

The job `Scope` decides the lane and the areas (`scripts/ci-scope.ts`) and lists them in its summary. The job `CI result` fails when any job failed or was cancelled and passes when the others passed or were skipped; it is the one check branch protection needs. The pnpm store, the Turborepo cache and Docker layers are cached between runs; on `main` the unit tests ignore cached results.

Dependabot proposes dependency updates weekly (`.github/dependabot.yml`).
