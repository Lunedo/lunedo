# Continuous integration

CI runs on GitHub Actions. This page lists the workflows and jobs, decides which job runs when, and says how to run the same checks before pushing. Runners, caches and parallelism are in [self-hosted-runners.md](self-hosted-runners.md).

## Workflows

| Workflow | Trigger | Purpose |
|---|---|---|
| `ci.yml` | pull requests (opened, pushed, reopened, ready for review), pushes to `main`, Saturdays 02:00 UTC (stress run), manual | Every check and test, see [Jobs](#jobs). |
| `api-label.yml` | adding or removing a label on a pull request | When the label is `breaking-api-change`, runs the latest CI run of the pull request again, so the [API compatibility](#quick-checks) result follows the label. Other labels start nothing. |
| `image.yml` | pushes to `main`, release tags `v*`, Mondays 03:00 UTC, manual | Builds the images without publishing them: amd64 only on pushes to `main`, amd64 and arm64 otherwise. A release tag publishes them instead, see [Releases](#releases). |
| `audit.yml` | Mondays 05:00 UTC, manual | `pnpm audit` on `main`, failing on any known vulnerability and listing the findings in the job summary; compares the pinned SheetJS release. On self-hosted runners it also prunes the caches on the runner. |

A newer push to the same pull request or branch cancels the running `ci.yml` workflow. The stress run has its own concurrency group.

## Lanes

`ci.yml` has two lanes:

- **Fast lane**, for draft pull requests: the job "Lint, typecheck and checks", the unit tests of the packages affected since the base branch (Turborepo `--affected`), and "Quick checks".
- **Full lane**, when a pull request is ready for review, on every further push to it, on `main`, for the stress run and for manual runs: all unit tests, plus the expensive jobs whose area changed (see [Scope](#scope)). On `main` and in the stress run every job runs, and the unit tests ignore cached Turborepo results.

The job "Scope" decides the lane and the areas (`scripts/ci-scope.ts`, run by `scripts/check-ci-scope.ts`) and lists them in its summary.

## Jobs

| Job | What it runs |
|---|---|
| Scope | Decides the lane and the areas; records the user of the runner for the end-to-end container. |
| Give the end-to-end tests a runner first | Holds back every other job for a few seconds, so the end-to-end job, the longest one, gets a runner first. |
| Lint, typecheck and checks | See [below](#lint-typecheck-and-checks). |
| Unit tests (1 of 3, 2 of 3, 3 of 3) | `turbo run test` in three shards, with PostgreSQL, Mailpit, Valkey and S3-compatible storage as service containers. |
| Backup round trip | Builds the image for amd64, checks its size, then backs up an instance, restores it and compares (`scripts/backup-roundtrip.sh`). |
| Installation, update and reverse proxies | See [below](#installation-update-and-reverse-proxies). |
| End-to-end, accessibility and visual tests | `pnpm build`, `pnpm --filter @lunedo/web build:e2e` and the Playwright tests inside the Playwright container, see [web-client.md](web-client.md#end-to-end-tests). |
| Sign-in through identity providers | The Playwright project `idp` against Keycloak, Authentik and OpenLDAP, see [test-identity-providers.md](test-identity-providers.md). |
| Quick checks | See [below](#quick-checks). |
| Flaky tests | Lists the tests that needed a retry, see [Retries and flaky tests](#retries-and-flaky-tests). |
| CI result | Fails when any job failed or was cancelled, passes when the others passed or were skipped. It is the one check branch protection needs. |

### Lint, typecheck and checks

| Command | Checks |
|---|---|
| `pnpm lint` | Biome, and ESLint for the type-aware promise rules. |
| `pnpm references:check` | No references to private project documents. |
| `pnpm name:check` | The former product name appears only where the check allows it. |
| `pnpm patches:check` | Patched dependencies did not change. |
| `pnpm playwright-image:check` | The Playwright container image matches the Playwright version in the lockfile. |
| `pnpm i18n:check` | See [Translations](#translations). |
| `pnpm shell:check` | Shell scripts, with ShellCheck in Docker. |
| `pnpm release-jobs:check` | Jobs that may write packages or the repository run only on GitHub-hosted runners and run images by digest. |
| `pnpm container-users:check` | Job containers and `docker run` calls that mount the workspace or the CI cache run with the runner's user. |
| `pnpm migrations:check` | Migrations are numbered without gaps or duplicates, each has its SQL file and snapshot, and their `when` timestamps increase. See [Migration number conflicts](environment.md#migration-number-conflicts). |
| `pnpm typecheck` | TypeScript in every package. |
| `node --test "scripts/*.test.ts"` | Tests of the repository scripts. |

### Quick checks

- **Sign-off**: every commit of a pull request has a `Signed-off-by` line of its author (`scripts/check-dco.ts`). Pull requests of Dependabot are exempt.
- **API compatibility**: compares `apps/api/openapi.json` with the base branch and fails on a breaking change unless the pull request has the label `breaking-api-change`; see [api.md](api.md#api-compatibility-check). It runs only for pull requests.
- **Licenses**: `pnpm licenses:check`.
- **Dependency audit**: `pnpm audit --audit-level=high`.

### Installation, update and reverse proxies

The job builds the image under test and the previous version: the newest release tag, or, before the first release, the image of the commit before this change. Then it runs three scripts:

- `scripts/install-update-check.sh` installs the previous version with the setup script, adds synthetic content, updates to the image under test with one command, runs the setup script again, checks that an update to a version that does not start stops with the rollback, and follows the documented rollback.
- `scripts/reverse-proxy-check.sh`: CI starts each reverse proxy example in front of a test instance and checks a page, a WebSocket connection to `/collab` and a large upload.
- `scripts/backup-network-check.sh` starts the storage service example of the backup documentation with the Compose file of the setup script and checks that Lunedo reaches only the storage service.

The examples are read from the documentation pages, from the blocks marked `<!-- reverse-proxy-check: NAME -->` and `<!-- backup-network-check -->`, so the documented examples are the ones that are tested.

## Scope

On a pull request in the full lane, the expensive jobs run only when their area changed. Changes to these paths run all of them: `.github/workflows/`, `.nvmrc`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json` and `packages/config/`. Pushes to `main`, the stress run and manual runs always run all of them.

| Job | Runs on pull requests when these change |
|---|---|
| End-to-end, accessibility and visual tests | `apps/web/`, `apps/render/`, `packages/ui/`, `packages/tokens/` |
| Accessibility and screenshot sweeps, inside the end-to-end job | the end-to-end job runs, and one of `apps/web/src/`, `apps/web/e2e/`, `apps/web/public/`, `apps/web/index.html`, `apps/web/vite.config.ts`, `apps/web/playwright.config.ts`, `packages/ui/`, `packages/tokens/` changed |
| Sign-in through identity providers | identity, authentication and session code in server, API and web client (`packages/server/src/identity/`, `packages/server/src/auth/`, `apps/api/src/identity/`, `apps/api/src/auth/`, `apps/web/src/screens/auth/`, `apps/web/src/screens/identity/`, `apps/web/src/session/`), the test fakes, `packages/shared/src/identity-providers.ts`, `apps/web/e2e/idp/`, `apps/web/e2e/support/`, `apps/web/e2e/global-setup.ts`, `apps/web/playwright.config.ts`, `docker/idp/`, `docker/compose.dev.yml`, `docker/compose.ci.yml` |
| Backup round trip | `packages/server/src/backup/`, `packages/server/src/files/`, `packages/server/src/crypto/stream.ts`, `packages/server/drizzle/`, `apps/worker/src/cli/`, `docker/Dockerfile`, `docker/start.sh`, `docker/runtime/`, `scripts/bundle-server.ts`, `scripts/backup-roundtrip.sh` |
| Installation, update and reverse proxies | the image (`docker/Dockerfile`, `docker/start.sh`, `docker/runtime/`, `scripts/bundle-server.ts`), the setup script and the three check scripts, the documentation pages with the checked examples, `packages/server/src/operations/`, `packages/server/src/portal/`, `packages/server/src/config/`, `packages/server/drizzle/`, `apps/api/src/health/`, `apps/api/src/portal/`, `apps/api/src/http/`, `apps/api/src/main.ts`, `apps/collab/`, `apps/worker/src/cli/` |

The exact lists are in `scripts/ci-scope.ts`; its tests cover them.

## Running the checks locally

Before pushing, run:

```sh
pnpm verify
```

`scripts/verify.ts` fetches `origin/main` and runs every command of the jobs "Lint, typecheck and checks" and "Quick checks" one after the other, with `origin/main` as the base for the sign-off and API checks, and names every step that failed at the end. The docs check (`scripts/docs-check.ts`) verifies links, anchors, navigation and documentation targets. A script test fails when a command of these two jobs is missing from `pnpm verify`. The API compatibility step needs Docker.

`pnpm verify` does not run the unit, integration or end-to-end tests. Run `pnpm test` for the unit and integration tests; they need the services described in [database.md](database.md#tests).

Locally, `pnpm test` and `pnpm typecheck` run Turborepo through `scripts/run-turbo.ts`, which keeps the machine usable: it derives a process budget from the logical cores (all of them on Linux and macOS, half of them on Windows) and splits it into Turborepo tasks of 4 Vitest workers or compiler threads each. `LUNEDO_PARALLELISM` sets the budget, for example `LUNEDO_PARALLELISM=16 pnpm test`; `LUNEDO_TEST_WORKERS` sets the Vitest workers of a single package. In CI the script changes nothing. Turborepo runs with `--continue`: every package runs to the end, and the summary lists every package that failed. A test process that ends abnormally fails its package, and Vitest names the file it was running.

### Translations

`pnpm i18n:check` (`scripts/check-i18n.ts`) fails when:

- a component in `apps/web/src` or `packages/ui/src` contains text that does not come from the messages,
- a key exists in one language only,
- a message is empty,
- a key is missing for an audit event, a setting or a value of a setting list.

A unit test of the web client (`apps/web/src/i18n/coverage.test.ts`) checks that every key the code uses exists in every language.

## Retries and flaky tests

In CI a failed test is retried once, in Vitest and in Playwright; a test that passes on the retry does not fail the run. Locally nothing is retried. `CI_RETRIES` overrides the number of retries.

The job "Flaky tests" lists every test that needed the retry (file, test, job) and attaches the list as the artifact `flaky-tests`. Fix these tests: a retry only hides the instability, see [stable-tests.md](stable-tests.md). The browser jobs keep the trace and error context of every failed attempt together with the server log as the artifacts `e2e-failed-attempts` and `identity-provider-failed-attempts`, also when the retry passed. Both browser jobs record CPU, I/O wait, runnable processes and memory of the host every 5 seconds (`scripts/record-vm-load.ts`) and show them in their summary.

The stress run on Saturday nights runs the full lane on `main` with `CI_RETRIES=0`, so load-dependent failures show up. It blocks nothing.

## Test databases in CI

Every PostgreSQL used by tests in CI runs with `fsync=off`, `synchronous_commit=off` and `full_page_writes=off` and keeps its data directory on tmpfs: the service containers of the unit and end-to-end jobs (`--tmpfs`, then `scripts/tune-test-postgres.ts` sets and verifies the settings), the PostgreSQL of the identity provider job (`docker/compose.ci.yml`, merged over `docker/compose.dev.yml`; the database of Authentik keeps its defaults) and the database of the backup round trip (`scripts/backup-roundtrip.sh` when `CI` is set). Dumps and restores still run against a real server. Local development keeps the normal settings.

## Releases

A release tag such as `v1.4.2` publishes `ghcr.io/lunedo/lunedo` and `ghcr.io/lunedo/render`, creates the GitHub release with the text of `docs/releases/<version>.md` from the tagged commit, and attaches `lunedo-versions.json` and `install.sh` to it. The format of `CHANGELOG.md` is described in [changelog.md](changelog.md).

- The job "Check the release tag" refuses a tag that is not a release version, whose commit is not on `main` or that has no `docs/releases/<version>.md`.
- The images always get the tag `1.4.2`. `1.4` and `latest`, and the GitHub release as the latest one, move only when the tag is the highest release version, so a patch for an older line never moves them back.
- Each image is built natively per architecture, amd64 on `ubuntu-24.04` and arm64 on `ubuntu-24.04-arm`, and pushed by digest; the job "Publish the images" joins both into one manifest per image, gives it the tags and fails when an architecture is missing.
- The jobs that hold `packages: write` or `contents: write` run only on GitHub-hosted runners (`ubuntu-24.04`, `ubuntu-24.04-arm`), never on `RUNNER_LABELS`, because self-hosted runners also run the code of pull requests. A job with `runs-on: ${{ matrix.runner }}` passes only when every `runner` of its matrix is such a runner. The job that reads the release notes runs the image by the digest the publish job reported, with `--pull always`. `pnpm release-jobs:check` enforces both.
- The workflows rely on a tag ruleset for `v*` in the repository settings, so that only maintainers create, move or delete release tags.

## Dependabot

Dependabot (`.github/dependabot.yml`) opens pull requests once a month in two groups that span npm, GitHub Actions, the Dockerfiles in `docker/` and the Compose files in `docker/`:

- `minor-and-patch`: minor and patch updates,
- `major`: major updates.

npm updates wait 3 days after a release (`cooldown`). Major updates of `@types/node`, of the Node.js base image and of PostgreSQL in the Compose files are ignored; they are done by hand. Dependabot's pull requests need no sign-off.
