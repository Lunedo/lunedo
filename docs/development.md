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

### Behind a public HTTPS address

Cloud identity providers such as Microsoft Entra ID accept only HTTPS redirect URIs. To test against them, put a tunnel or reverse proxy with a public HTTPS hostname in front of the Vite dev server, for example a Cloudflare Tunnel to `http://localhost:5173`, and start the environment with that address:

```sh
PAGEHALL_INSTANCE_URL=https://pagehall-test.example.org pnpm dev
```

With a public address in `PAGEHALL_INSTANCE_URL`:

- Vite accepts requests for that hostname and connects hot reload through it (`wss`, port 443).
- The Vite proxy forwards `/api` with `X-Forwarded-For`, and with the protocol and host of the instance URL. The API trusts these headers only from the dev proxy in the same container (`PAGEHALL_TRUSTED_PROXIES=127.0.0.1,::1` in `docker/compose.dev.yml`); requests to the published port 3000 come from another address and keep their own.
- Until the setup assistant stores the instance URL, the API uses the configured one for redirect URIs and for the origin check of state-changing requests. Use the same address in the assistant.
- Cookies are always `Secure` and use the `__Host-` prefix, so the browser keeps them over HTTPS and on `localhost`, but not on other plain HTTP addresses.

Open Pagehall under the public address while it is set: hot reload goes through the tunnel also when the page is opened on `localhost`. Leave `PAGEHALL_INSTANCE_URL` empty for purely local work.

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
| `ci.yml` | pull requests, pushes to `main`, Saturdays 02:00 UTC (stress run), manual | see below |
| `image.yml` | pushes to `main`, release tags `v*`, Mondays 03:00 UTC, manual | image build, not published; amd64 only on pushes to `main`, amd64 and arm64 otherwise |
| `audit.yml` | Mondays 05:00 UTC, manual | `pnpm audit` on `main`; fails on any known vulnerability and lists the findings in the job summary |

`ci.yml` has two lanes. A newer push to the same pull request or branch cancels the running workflow.

- Fast lane, for draft pull requests: lint, reference and translation checks, typecheck, script tests, unit tests of the packages affected since the base branch (Turborepo `--affected`, split into three shards against PostgreSQL), the quick checks (DCO sign-off, API description against the base branch, license check, dependency audit).
- Full lane, when a pull request is ready for review, on every push to it, on `main` and on manual runs: the fast lane with all unit tests, plus the expensive jobs below. On a pull request they run only when their area changed; changes to workflows or shared dependencies (`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json`, `.nvmrc`, `packages/config/`) run all of them, and `main` always runs all of them.

| Job | Runs on pull requests when these change |
|---|---|
| End-to-end, accessibility and visual tests | `apps/web/`, `packages/ui/`, `packages/tokens/` |
| Sign-in through identity providers | identity, authentication and sign-in code in server, API and web client including SAML and LDAP, the shared provider configuration, `apps/web/e2e/idp/`, the end-to-end setup, `docker/idp/`, `docker/compose.dev.yml` |
| Backup round trip (builds the image for amd64 only) | `packages/server/src/backup/`, `packages/server/drizzle/`, `apps/worker/src/cli/`, `docker/Dockerfile`, `docker/start.sh`, `scripts/backup-roundtrip.sh` |

The job `Scope` decides the lane and the areas (`scripts/ci-scope.ts`) and lists them in its summary. The job `CI result` fails when any job failed or was cancelled and passes when the others passed or were skipped; it is the one check branch protection needs. The pnpm store, the Turborepo cache and Docker layers are cached between runs; on `main` the unit tests ignore cached results.

In CI a failed test is retried once, in Vitest and in Playwright; a test that passes on the retry does not fail the run. Locally nothing is retried. The job `Flaky tests` lists every test that needed the retry (file, test, job) in its summary and attaches the list as the artifact `flaky-tests`; fix these tests, a retry only hides the instability. The stress run on Saturday nights starts every job of the full lane at the same time on `main` with `CI_RETRIES=0`, so load-dependent failures show up. Its summary lists every failed test. It blocks nothing and opens no issue.

In CI every PostgreSQL used by tests runs with `fsync=off`, `synchronous_commit=off` and `full_page_writes=off` and keeps its data directory on tmpfs: the service containers of the unit and end-to-end jobs (`--tmpfs`, then `scripts/tune-test-postgres.ts` sets and verifies the settings), the PostgreSQL of the identity provider job (`docker/compose.ci.yml`, merged over `docker/compose.dev.yml`; the database of Authentik keeps its defaults, because sign-in through Authentik timed out with it on tmpfs and without durability) and the database of the backup round trip (`scripts/backup-roundtrip.sh` when `CI` is set). Dumps and restores still run against a real server, so the comparison is unchanged. Local development and `docker/compose.dev.yml` alone keep the normal settings.

Every job runs on the runners named in the repository variable `RUNNER_LABELS`, a JSON array such as `["self-hosted","linux","x64","pagehall"]`. Without the variable, jobs run on GitHub-hosted `ubuntu-24.04`, so no code changes when the repository goes public. When `RUNNER_LABELS` names a self-hosted runner, no job runs for pull requests from forks; `CI result` then runs on `ubuntu-24.04` and fails, so such a pull request cannot pass the required check.

Several runners can share one host. Jobs publish no fixed host ports: unit test services get random ports, and the identity provider job picks free ports with `scripts/pick-free-ports.ts`, names its compose project after the workflow run and removes only that project's containers, volumes and images. The compose file reads the ports from `POSTGRES_PORT`, `VALKEY_PORT`, `MAILPIT_SMTP_PORT`, `MAILPIT_PORT`, `KEYCLOAK_PORT`, `AUTHENTIK_PORT` and `LDAP_PORT`, defaulting to the usual ones for local development.

The repository variable `CI_PARALLELISM` limits how many processes one job starts. When it is set, it caps the Vitest workers, Turborepo's task concurrency (`TURBO_CONCURRENCY`) and the threads of the TypeScript compiler (`GOMAXPROCS`) and Biome (`RAYON_NUM_THREADS`); without it every tool sizes itself to the CPU count, as on GitHub-hosted runners. Set it to the number of CPUs divided by the number of runners on the host, for example `3` for three runners on 10 vCPUs.

Runners on one host must not share caches. Give each runner its own directories in the runner's `.env`: `npm_config_store_dir` (pnpm store), `PLAYWRIGHT_BROWSERS_PATH`, `COREPACK_HOME` and `XDG_CACHE_HOME`. The pnpm store is therefore not restored through `actions/cache` on self-hosted runners; the end-to-end job runs in a fresh container and keeps its store cache.

Adding or removing the label `breaking-api-change` runs CI again in its own concurrency group, because it changes the result of the API check; other labels do not start a run. On self-hosted runners the backup job builds the image with the Docker daemon of the host and its local layer cache instead of the GitHub Actions cache, and a build that takes longer than 15 minutes is stopped.

Dependabot opens one pull request per ecosystem every Monday (`.github/dependabot.yml`).
