# Requirements

What Lunedo needs to run. The [setup script](installation/script.md) checks the host part itself and says what is missing.

## Host

| Requirement | Value |
|---|---|
| Operating system | Linux. Lunedo is not supported on macOS or Windows hosts, and the setup script refuses to run on macOS. |
| Container runtime | Docker Engine 24 or newer with Docker Compose v2. |
| Architecture | The image `ghcr.io/lunedo/lunedo` is published for `linux/amd64` and `linux/arm64`. |
| CPU and RAM | Depend on the size of the organization; see [Measured requirements](#measured-requirements). |
| Disk space | The setup script needs at least 4 GB free to install. What the data and backups need later is listed under [Measured requirements](#measured-requirements). |
| Port | One free host port for Lunedo, `3000` by default. |
| Clock | Synchronized, for example with NTP. The [system check](system-check.md#clock) warns when Lunedo and the database differ by more than 5 seconds. |

## Database

| Requirement | Value |
|---|---|
| Server | PostgreSQL 16, 17 or 18. The image contains `pg_dump`, `pg_restore` and `psql` for these three major versions and picks the one that matches the server for backups. The Compose file of the setup script uses `postgres:17-alpine`. |
| Shared memory | 1 GB of `/dev/shm` for the PostgreSQL container (`shm_size: 1gb` in the Compose file of the setup script). Parallel queries on large databases fail without it, because Docker gives a container only 64 MB. It is used only while queries need it and counts towards the memory of PostgreSQL. |
| Connection settings | Lunedo turns off just-in-time compilation (`jit`) for its own connections by sending `-c jit=off` as a startup option. Nothing changes on the server. |
| Extension | `pg_trgm`, for search. A migration creates it with `CREATE EXTENSION IF NOT EXISTS "pg_trgm"`. It is a trusted extension, so a database user with the `CREATE` privilege on the database can create it. On a managed server that does not allow this, create it beforehand as an administrator of the server. |
| Rights | The user in `LUNEDO_DATABASE_URL` owns the database or may create tables, types and indexes in it. Lunedo applies its migrations at every start. |
| Optional right | `CREATEDB` for the monthly test restore of backups, which restores into a temporary database on the same server, for example `ALTER ROLE "lunedo" CREATEDB;`. Without it, a test restore only verifies the backup. See [Backups](backups.md). |
| Free space | Room for one more copy of the database while a test restore runs. |

### Database connections

A container runs the worker, the collaboration server and one API process per CPU, at most 8 (`LUNEDO_API_PROCESSES` sets another number). Requests are spread over the API processes, so the API uses more than one CPU without a proxy in front of several containers.

Each process has its own pool of database connections. Without `LUNEDO_DATABASE_POOL_SIZE`, the worker and the collaboration server use twice the number of CPUs of the container plus 2, at least 6 and at most 24, and this number is divided among the API processes, at least 8 each. With `LUNEDO_DATABASE_POOL_SIZE`, every process, each API process included, uses that number. Every process also holds one connection for notifications; the worker holds up to four more for the job queue and every API process one.

Add up for every container that uses the same database:

- worker: pool size + 5
- collaboration server: pool size + 1
- every API process: pool size + 2 + search slots

The sum, plus a few connections for backups and `psql`, must stay below `max_connections` of PostgreSQL. With the defaults, one container on up to 5 CPUs stays below the PostgreSQL default of 100, for example 70 connections on 4 CPUs; on 8 CPUs it needs 138. The PostgreSQL container of the setup script sets `max_connections` to 200. Raise `max_connections` before you raise the pool size or the number of API processes, or run more containers.

### Searches at once

Searches run in PostgreSQL in a lane of their own, so that many broad searches cannot slow down opening pages:

- At most `LUNEDO_SEARCH_SLOTS` searches run at the same time, counted for all API processes and containers that use the same database: by default a quarter of the CPUs of the container, at least 1 and at most 4. When PostgreSQL runs on another machine, set it to a quarter of that machine's CPUs.
- A search waits for a free slot for at most `LUNEDO_SEARCH_WAIT_SECONDS` (2 by default) without holding a database connection. After that the API answers `429` with `Retry-After`, and the app says that search is busy and tries once more.
- Searches use connections of their own (`lunedo-search` in `pg_stat_activity`, one per slot in every API process), without parallel query, and each statement may run at most `LUNEDO_SEARCH_TIMEOUT_SECONDS` (5 by default).

The metrics `lunedo_search_slot_wait_seconds`, `lunedo_search_slots_in_use` and `lunedo_search_rejected_total` show how full the lane is; see [Monitoring](monitoring.md).

Limits that protect the memory of a process count per API process: diagram sanitizing and uploads, Word and PDF files created at once and password checks.

Migrations only go forward. When several processes start at the same time, a PostgreSQL advisory lock lets one of them migrate while the others wait. Readiness (`/health/ready`) answers `503` while the schema is behind the code. When migrations are pending, the first process takes a backup before it migrates; see [Backups before updates](updates.md#backups-before-updates).

## Optional services

| Service | When it is needed |
|---|---|
| Redis or Valkey | Only when more than one collaboration server runs. Set `LUNEDO_REDIS_URL` on every collaboration node; see [Several nodes](reverse-proxy.md#several-nodes). Any Redis-compatible server works. |
| Render container | Only for PDF files created on the server. The image `ghcr.io/lunedo/render` runs headless Chromium; see [Rendering](rendering.md). |
| S3-compatible storage | Only when attachments or backups go to object storage. See [File storage](storage.md) and [Backups in S3](backups/s3.md). |
| Mail server or Microsoft Graph | For invitations, password resets and e-mail notifications. See [E-mail](email.md). |

## Container roles

One image holds every part of Lunedo. The first argument of the container chooses what it runs:

| Role | Port | Runs |
|---|---|---|
| `all` | 3000, 3001, 3002 | The API, the collaboration server and the worker in one container. The default, and what the Compose files use. |
| `api` | 3000 | The API and the web client. It also forwards the collaboration WebSocket on `/collab` to `LUNEDO_COLLAB_UPSTREAM`. |
| `collab` | 3001 | The collaboration server for real-time editing. |
| `worker` | 3002 | Background jobs: backups, mail, search indexing, imports, rendering and the update check. |

In `all`, only the API port needs to be published; the API forwards `/collab` to the collaboration server in the same container. Each process answers `/health/live`, `/health/ready` and `/metrics` on its own port; see [Monitoring](monitoring.md).

Every other argument runs a command instead of a server, such as `backup`, `keys`, `audit`, `search`, `maintenance`, `version` or `release-notes`. See [Command line](cli.md#lunedo-in-the-image).

## Container user and volumes

The container runs as the user `node` with UID 1000 and GID 1000.

| Path in the container | Content |
|---|---|
| `/var/lib/lunedo` | The data volume: `files` (the file store, `LUNEDO_FILES_DIR`), `secrets` (generated secrets, `LUNEDO_SECRETS_DIR`), `backups` (`LUNEDO_BACKUP_DIR`) and `work` (temporary files of backups, `LUNEDO_WORK_DIR`). |
| `/data/import` | The import folder for large exports (`LUNEDO_IMPORT_DIR`). Mount it read-only; see [Imports](imports.md). |

Directories that you mount must belong to UID 1000, or the [system check](system-check.md#file-storage) reports that the file store is not writable.

## Measured requirements

<!-- generated:measured-requirements -->

This section is generated from `docs/data/requirements.json`, `packages/server/src/backup/configuration.ts` by `pnpm docs:generate`. Do not edit it by hand; change the sources and run the command again.

Measured on a reference machine with 4 vCPU (12th Gen Intel(R) Core(TM) i5-12500), 7.8 GiB of RAM and 272.5 GB of disk, running Ubuntu 24.04.5 LTS with kernel 6.8.0-147-generic, Docker 29.9.2, Docker Compose 5.6.1 and PostgreSQL 17.11. Each size ran on a fresh installation from the setup script, without TLS and without a reverse proxy, with synthetic content and the default limits. Size, backups and start times were measured on 2026-10-29 with commit `8c70161e`. The load came from one computer, which sent the requests of each person from a client address of its own, in load runs of 15 minutes.

### Scenarios

The load runs follow one of two scenarios. Both are assumptions about how people use a wiki, not measured use. In both, five of the people active at the same time edit the same page together.

| Scenario | Wait between two actions | Open a page | Search | Edit and publish | Notifications and For you |
|---|---|---|---|---|---|
| typical | 30 to 90 seconds, 60 on average | 70 % | 15 % | 2 % | 13 % |
| peak | 7 to 36 seconds, 18 on average | 70 % | 15 % | 10 % | 5 % |

The targets apply to **typical**; **peak** shows how much room is left. A size measured only with peak is judged by peak, and its hardware comes from peak.

| Size | Scenario | Load runs | Measured on | Commit |
|---|---|---|---|---|
| small | peak | 3 | 2026-10-29 | `8c70161e` |
| medium | peak | 3 | 2026-10-29 | `8c70161e` |
| large | peak | 3 | 2026-10-29 | `8c70161e` |

### Sizes

| Size | People | Pages | Spaces | Attachments | Active at the same time |
|---|---|---|---|---|---|
| small | 25 | 2,002 | 10 | 1.9 GB | 5 |
| medium | 250 | 20,048 | 60 | 19.5 GB | 50 |
| large | 1,000 | 99,594 | 200 | 48.9 GB | 200 |

### Hardware

**Minimum** is what the reference machine used at the peak of the load runs, rounded up: CPU from the busy time of the whole machine, RAM from the Lunedo and PostgreSQL containers. Add what the operating system needs. **Recommended** RAM is the peak × 1.5, and recommended CPU keeps the response times below the targets with room for peaks. Disk is the image, the database, the file store and backups, with 30 % headroom; with backups on the same host, it counts the 20 backups that the default retention keeps.

| Size | Minimum CPU | Minimum RAM | Minimum disk | Recommended CPU | Recommended RAM | Recommended disk, backups elsewhere | Recommended disk, backups on this host |
|---|---|---|---|---|---|---|---|
| small | 2 vCPU | 2 GiB | 6 GB | 3 vCPU | 3 GiB | 7 GB | 56 GB |
| medium | 4 vCPU | 2 GiB | 42 GB | more than 4 vCPU; the targets were missed on the reference machine | 3 GiB | 55 GB | 541 GB |
| large | 4 vCPU | 4 GiB | 107 GB | more than 4 vCPU; the targets were missed on the reference machine | 6 GiB | 139 GB | 1,371 GB |

The minimum of medium and large is what the reference machine used while it missed the targets, not what keeps these sizes usable.

### Response times under load

Median of the load runs; p95 is the time within which 95 % of the requests finished. **Readable** is the time until the page is shown in the browser.

| Size | Scenario | Open a page, API | Open a page, readable | Search | Save | For you and notifications | Errors |
|---|---|---|---|---|---|---|---|
| small | peak | 160 ms / 256 ms | 353 ms / 855 ms | 86 ms / 136 ms | 54 ms / 85 ms | 45 ms / 69 ms | 0 |
| medium | peak | 271 ms / 1.20 s | 829 ms / 1.84 s | 252 ms / 865 ms | 89 ms / 349 ms | 404 ms / 919 ms | 0 |
| large | peak | 23.7 s / 32.7 s | 11.4 s / 28.0 s | 9.04 s / 18.5 s | 8.14 s / 14.9 s | 9.71 s / 15.6 s | 58,616 |

Each cell shows p50 / p95.

### Targets

| Size | Scenario | Target | Limit | Measured (worst run) | Met |
|---|---|---|---|---|---|
| small | peak | Open a page, API (p95) | below 500 ms | 263 ms | yes |
| small | peak | Open a page, readable (p95) | below 1.50 s | 879 ms | yes |
| small | peak | Search (p95) | below 800 ms | 148 ms | yes |
| small | peak | Save (p95) | below 500 ms | 101 ms | yes |
| small | peak | Errors | 0 | 0 | yes |
| medium | peak | Open a page, API (p95) | below 500 ms | 1.48 s | no |
| medium | peak | Open a page, readable (p95) | below 1.50 s | 1.93 s | no |
| medium | peak | Search (p95) | below 800 ms | 1.41 s | no |
| medium | peak | Save (p95) | below 500 ms | 375 ms | yes |
| medium | peak | Errors | 0 | 0 | yes |
| large | peak | Open a page, API (p95) | below 500 ms | 33.0 s | no |
| large | peak | Open a page, readable (p95) | below 1.50 s | 29.6 s | no |
| large | peak | Search (p95) | below 800 ms | 22.6 s | no |
| large | peak | Save (p95) | below 500 ms | 22.2 s | no |
| large | peak | Errors | 0 | 58,616 | no |

### Footprint and operations

| Size | Database | File store | Image | One full backup | Backup takes | Restore takes | Start until ready | RAM when idle | New page found in search (p95) | Job queue under load (peak) |
|---|---|---|---|---|---|---|---|---|---|---|
| small | 150 MB | 2.0 GB | 1.1 GB | 2.0 GB | 45.5 s | 22.8 s | 9.30 s | 741 MiB | 700 ms | 16 |
| medium | 1.3 GB | 19.6 GB | 1.1 GB | 19.7 GB | 7 min 25 s | 4 min 52 s | 9.30 s | 826 MiB | 3.50 s | 16 |
| large | 6.4 GB | 49.2 GB | 1.1 GB | 49.9 GB | 20 min 8 s | 17 min 4 s | 10.0 s | 885 MiB | 8.90 s | 24 |

### Writing through the API

How fast the content of each size was written through the public API, as a migration script would do it: pages with their versions, attachments, comments and permissions, by several clients at once.

| Size | Clients at once | Pages per minute | Versions per minute | Requests per second | Upload | Busy CPU |
|---|---|---|---|---|---|---|
| small | 4 | 240 | 1,189 | 47 | 4.1 MB/s | 80 % |
| medium | 4 | 263 | 1,314 | 52 | 4.4 MB/s | 80 % |
| medium | 8 | 276 | 1,388 | 55 | 4.6 MB/s | 92 % |
| large | 4 | 228 | 1,142 | 43 | 2.0 MB/s | 83 % |

<!-- /generated:measured-requirements -->
