# Development environment

The development environment runs in Docker. You need Docker with Compose, Node.js (the version in `.nvmrc`) and pnpm through Corepack on the host.

## Start

1. Install the dependencies on the host once with `pnpm install`. This also installs the [Git hooks](#git-hooks).
2. Run `pnpm dev`.
3. Open `http://localhost:5173`. The `app` container prints a setup link with a setup code in its log; it leads to the setup assistant.

`pnpm dev` (`scripts/dev.ts`) first starts only PostgreSQL and compares the migrations applied to the development database with the migrations of the checked-out branch. When the database holds a migration the branch does not know, usually from another branch, it stops and asks you to run `pnpm dev:reset`, because the app would fail while migrating. Otherwise it runs `docker compose -f docker/compose.dev.yml up --build`.

`pnpm dev:down` stops the environment, including the identity providers.

## Services and ports

`docker/compose.dev.yml` starts these services. Every port is published on `127.0.0.1` only.

| Service | Port | Purpose |
|---|---|---|
| `postgres` | 5432 (`POSTGRES_PORT`) | PostgreSQL 16; user, password and database `lunedo`. |
| `valkey` | 6379 (`VALKEY_PORT`) | Redis-compatible server. The collaboration server uses it through `LUNEDO_REDIS_URL=redis://valkey:6379`, so the development environment runs the same path as an instance with several collaboration nodes. |
| `mailpit` | 1025 (`MAILPIT_SMTP_PORT`), 8025 (`MAILPIT_PORT`) | Catches all outgoing e-mail, see [Mailpit](#mailpit). |
| `s3` | 9100 (`S3_PORT`) | S3-compatible object storage (SeaweedFS), access key `lunedo`, secret key `lunedo-s3`. |
| `app` | 5173, 3000, 3001, 3002 | Lunedo with hot reload. |

The `app` container runs every process of Lunedo:

| Port | Process |
|---|---|
| 5173 | Vite dev server with the web client. It forwards `/api` and `/scim` to the API and `/collab` to the collaboration server. Open Lunedo here. |
| 3000 | API (`LUNEDO_API_PORT`). |
| 3001 | Collaboration server (`LUNEDO_COLLAB_PORT`). |
| 3002 | Health and metrics endpoints of the worker (`LUNEDO_WORKER_PORT`). |

The `app` service reports healthy when web, API, collaboration server and worker answer (`docker/dev-healthcheck.ts`).

The repository is mounted into the container. Dependencies live in Docker volumes, so the container never uses packages installed for the host system. File changes are detected by polling, because file system events do not reach containers through Windows bind mounts. The Node.js processes use `lunedo-dev` from `packages/config`, which rebuilds a package on changes and restarts its process; the web client uses Vite with polling.

Dependencies are installed when the `app` container starts. After pulling changes that add or update dependencies, restart it with `docker compose -f docker/compose.dev.yml restart app`.

The development instance stores files locally. The tests of the S3 file storage and the S3 backup target use the `s3` service when `LUNEDO_TEST_S3_ENDPOINT=http://localhost:9100` is set; each test creates its own bucket.

To run everything on the host instead, start PostgreSQL, set `LUNEDO_DATABASE_URL` and run `pnpm dev:apps`.

## Render container

The render container for PDF on the server belongs to the Compose profile `render` and does not start by default. To use it, start the environment with the profile and the same token for the app and the container, at least 32 characters:

```sh
COMPOSE_PROFILES=render LUNEDO_RENDER_URL=http://render:3000 LUNEDO_RENDER_TOKEN=<token of at least 32 characters> pnpm dev
```

The container listens on `localhost:3003` (`RENDER_PORT`). Docker Desktop does not give containers the user namespaces that Chromium's sandbox needs, so the development container runs without the sandbox (`RENDER_CHROMIUM_SANDBOX=false`) and logs a warning. Production setups keep it on, see [rendering.md](../admin/rendering.md#chromiums-sandbox).

## Mailpit

[Mailpit](https://mailpit.axllent.org/) catches every mail of the development instance. Its web interface is at `http://localhost:8025`.

To send mail from the development instance, open **Settings › Instance › Services › Delivery**, choose the sending method **SMTP** and enter host `mailpit`, port `1025` and the security **None (local relay only)**, without user name and password.

Integration tests that send mail use Mailpit when `LUNEDO_TEST_MAILPIT_URL=http://localhost:8025` is set; end-to-end tests use it by default. See [database.md](database.md#tests).

## Resetting the development data

`pnpm dev:reset` deletes all development data and asks for confirmation first; type `reset` to continue. It:

- stops and removes the `app` container,
- drops the development database `lunedo` and every database left behind by tests (`lunedo_*test_*`, `lunedo_e2e_*` and the migrated templates `lunedo_template_*` that tests copy),
- creates an empty development database,
- removes the `lunedo-data` volume with the development secrets (master keys, backup keys, metrics token) and files.

Start again with `pnpm dev`; the instance then asks for setup and prints a new setup code in the log of the `app` container.

## Migration number conflicts

Migrations are numbered in the order they are generated (`packages/server/drizzle/0105_….sql`). When `main` takes a number that your branch also uses:

1. Merge `origin/main` into your branch.
2. Remove your branch's migration: the SQL file, its snapshot in `packages/server/drizzle/meta/` and its entry in `meta/_journal.json`. Keep the ones from `main`.
3. Generate it again with `pnpm --filter @lunedo/server db:generate --name <short_description>`; it gets the next free number.
4. If the development database already applied the old migration, `pnpm dev` refuses to start. Run `pnpm dev:reset`.

See [database.md](database.md#migrations) for the rules about migrations.

## Behind a public HTTPS address

Cloud identity providers such as Microsoft Entra ID accept only HTTPS redirect URIs. To test against them, put a tunnel or reverse proxy with a public HTTPS hostname in front of the Vite dev server, for example a Cloudflare Tunnel to `http://localhost:5173`, and start the environment with that address:

```sh
LUNEDO_INSTANCE_URL=https://lunedo-test.example.com pnpm dev
```

With a public address in `LUNEDO_INSTANCE_URL`:

- Vite accepts requests for that hostname and connects hot reload through it.
- The Vite proxy forwards `/api` with `X-Forwarded-For`, and with the protocol and host of the instance URL. The API trusts these headers only from the dev proxy in the same container (`LUNEDO_TRUSTED_PROXIES=127.0.0.1,::1` in `docker/compose.dev.yml`); requests to the published port 3000 come from another address and keep their own.
- Until the setup assistant stores the instance URL, the API uses the configured one for redirect URIs and for the origin check of state-changing requests. Use the same address in the assistant.
- Cookies are always `Secure` and use the `__Host-` prefix, so the browser keeps them over HTTPS and on `localhost`, but not on other plain HTTP addresses.

Open Lunedo under the public address while it is set: hot reload goes through the tunnel also when the page is opened on `localhost`. Leave `LUNEDO_INSTANCE_URL` empty for purely local work.

## Identity providers

Keycloak, Authentik and OpenLDAP for sign-in tests start with `pnpm dev:idp`. Their addresses, clients and test users are in [test-identity-providers.md](test-identity-providers.md).

## Git hooks

`pnpm install` runs the `prepare` script (`scripts/install-hooks.ts`), which sets `core.hooksPath` to `.githooks`. Outside a Git work tree, such as in a Docker build, it does nothing.

| Hook | Check |
|---|---|
| `pre-commit` | `scripts/check-private-references.ts --staged` rejects staged files that reference private project documents. |
| `commit-msg` | `scripts/check-sign-off.ts` rejects a message without a `Signed-off-by` line for the author; sign off with `git commit -s`. The message is checked for private references as well. |

CI checks the sign-off of every commit of a pull request again, see [ci.md](ci.md).
