# Self-hosted runners

CI runs on GitHub-hosted runners unless the repository says otherwise. This page explains how to run it on your own runners and what to set up on their host. The jobs themselves are described in [ci.md](ci.md).

## Choosing the runners

Every job except the release jobs runs on the runners named in the repository variable `RUNNER_LABELS`, a JSON array such as `["self-hosted","linux","x64","lunedo"]`. Without the variable, jobs run on GitHub-hosted `ubuntu-24.04`, so no workflow changes when the repository uses GitHub's runners.

When `RUNNER_LABELS` names a self-hosted runner, no job runs for pull requests from forks, because self-hosted runners would run their code. "CI result" then runs on `ubuntu-24.04` and fails, so such a pull request cannot pass the required check; run its checks in a branch of the repository instead.

Jobs that hold `packages: write` or `contents: write` always run on GitHub-hosted runners, see [ci.md](ci.md#releases).

## Several runners on one host

Several runners can share one host. Jobs publish no fixed host ports:

- Unit test services get random ports.
- The identity provider job picks free ports with `scripts/pick-free-ports.ts`, names its Compose project after the workflow run and removes only that project's containers, volumes and images. The Compose file reads the ports from `POSTGRES_PORT`, `VALKEY_PORT`, `MAILPIT_SMTP_PORT`, `MAILPIT_PORT`, `KEYCLOAK_PORT`, `AUTHENTIK_PORT` and `LDAP_PORT`, defaulting to the usual ones for local development. It keeps its state in the runner's temporary directory.
- The end-to-end job runs in its own container with its services on the job's private network and its state on a tmpfs.
- The backup and installation jobs label their containers with the run and remove leftovers of earlier runs that are older than 6 hours.

All runners on a host must run as the same user, see [Containers and file owners](#containers-and-file-owners).

## Parallelism

| Repository variable | Effect |
|---|---|
| `CI_PARALLELISM` | Caps the processes of one job: the Vitest workers, Turborepo's task concurrency (`TURBO_CONCURRENCY`) and the threads of the TypeScript compiler (`GOMAXPROCS`) and Biome (`RAYON_NUM_THREADS`). Without it every tool sizes itself to the CPU count, as on GitHub-hosted runners. Set it to the number of CPUs divided by the number of runners on the host, for example `3` for three runners on 10 vCPUs. |
| `E2E_WORKERS` | Number of Playwright workers of the end-to-end job. Without it, the job uses `CI_PARALLELISM`, or 3 when neither is set. |

The Playwright projects that change instance-wide state and the identity provider tests always run on one worker.

## Caches on self-hosted runners

On self-hosted runners no job uploads or downloads the pnpm store or the Turborepo cache through `actions/cache`. The jobs use directories on the host instead, below the repository variable `CI_CACHE_DIR` (default `/srv/ci-cache`). `scripts/prepare-ci-cache.ts` checks the directory, creates the job's subdirectories and points pnpm and Turborepo at them:

| Directory | Used by | Shared |
|---|---|---|
| `host/pnpm-store` | jobs that run directly on the runner, as the runner user | by all runners; pnpm installs may fill one store at the same time |
| `host/turbo/<runner name>` | the same jobs | no, one per runner, so parallel jobs never write the same entries |
| `e2e/pnpm-store` | the end-to-end job inside its container (mounted at `/ci-cache`), as the runner user | by all runners |
| `e2e/turbo/<runner name>`, `e2e/pnpm-cache/<runner name>` | the same job | no, one per runner |

Only pushes to `main` write these caches. Pull requests, scheduled and manual runs read the Turborepo cache of `main` with `TURBO_CACHE=local:r` and never write to it, so a pull request cannot place a result under a task hash that `main` would replay without running the task. pnpm has no read-only store, so those runs fill their own stores, `host/pnpm-store-pull-requests` and `e2e/pnpm-store-pull-requests` (plus `e2e/pnpm-cache-pull-requests/<runner name>`), which `main` never reads. `scripts/prepare-ci-cache.ts` decides this from `GITHUB_EVENT_NAME` and `GITHUB_REF`; its tests cover each event.

This stops Turborepo and pnpm from writing where `main` reads, but code of a pull request still runs as the runner user, which can write to the whole cache directory. Same-repository pull requests come from people with write access and from Dependabot, whose updates can run install scripts. To rule that out as well, run pull requests on runners whose user cannot write `host/turbo` and `host/pnpm-store`: register separate runners with their own label for pull requests under another user, or give the pull-request runners their own `CI_CACHE_DIR`.

The end-to-end tests keep their own tree, because they install and build inside the Playwright image, not on the host. GitHub-hosted runners keep `actions/cache`.

pnpm reads only `pnpm_config_*` variables, so an `npm_config_store_dir` in a runner's `.env` has no effect; the job sets `pnpm_config_store_dir` itself. Keep `PLAYWRIGHT_BROWSERS_PATH`, `COREPACK_HOME` and `XDG_CACHE_HOME` per runner in the runner's `.env`.

### Setting up the cache directory

1. On the runner host, as root, create the directory and give it to the user the runner services run as (here `runner`):

   ```sh
   install -d -o runner -g runner -m 0755 /srv/ci-cache
   ```

2. If you choose another path, set it in the repository variable `CI_CACHE_DIR`.

The jobs create their subdirectories themselves; the runner user needs to own the top directory only. A job fails at the start with a message pointing to this section when the directory is missing or not writable. Inside the end-to-end container, a directory owned by root means that Docker created it because it is missing on the host.

### Pruning

The weekly workflow `Audit` keeps the caches bounded: its job "Prune the caches on the runner" runs `pnpm store prune` on all four stores and removes Turborepo entries older than three days. The container stores lose the packages of workspaces they cannot see then; the next end-to-end job downloads them once.

## Containers and file owners

A job that writes into the workspace or the caches from a container runs that container with the runner's UID and GID, so every file stays removable by the runner user, also when the job is cancelled or killed. The job "Scope" records `id -u:id -g` of the runner, and the end-to-end job starts the Playwright container with `--user` set to it. Inside, `HOME` is a tmpfs of the container, set in the job's `env` because the runner overrides it in the container's; pnpm is enabled with `corepack enable --install-directory` in the job's temporary directory, and `scripts/install-postgres-client.sh` unpacks the PostgreSQL client tools for the backup test from the distribution's packages into the same directory, without root. The cache pruning of the `Audit` workflow runs its container the same way.

After these jobs, `scripts/check-file-owners.ts` fails the job when any file in the workspace, the runner's temporary directory or under `CI_CACHE_DIR` belongs to another user than the owner of the workspace, and names the files; it also runs when the job failed or was cancelled. `pnpm container-users:check` (`scripts/check-container-users.ts`) fails when a job container has no `--user`, or a `docker run` mounts the workspace or the CI cache without it.

## Docker images on the runner

On self-hosted runners the backup and installation jobs build the image with the Docker daemon of the host and its local layer cache instead of the GitHub Actions cache. A build that takes longer than 15 minutes is stopped.
