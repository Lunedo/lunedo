# Requirements

What Lunedo needs to run. The [setup script](installation/script.md) checks the host part itself and says what is missing.

## Host

| Requirement | Value |
|---|---|
| Container runtime | Docker Engine 24 or newer with Docker Compose v2. The setup script runs on Linux and macOS. |
| Architecture | The image `ghcr.io/lunedo/lunedo` is published for `linux/amd64` and `linux/arm64`. |
| Disk space | At least 4 GB free for the images and the first data, plus room for attachments, backups and the database. |
| Port | One free host port for Lunedo, `3000` by default. |
| Clock | Synchronized, for example with NTP. The [system check](system-check.md#clock) warns when Lunedo and the database differ by more than 5 seconds. |

## Database

| Requirement | Value |
|---|---|
| Server | PostgreSQL 16, 17 or 18. The image contains `pg_dump`, `pg_restore` and `psql` for these three major versions and picks the one that matches the server for backups. The Compose file of the setup script uses `postgres:17-alpine`. |
| Extension | `pg_trgm`, for search. A migration creates it with `CREATE EXTENSION IF NOT EXISTS "pg_trgm"`. It is a trusted extension, so a database user with the `CREATE` privilege on the database can create it. On a managed server that does not allow this, create it beforehand as an administrator of the server. |
| Rights | The user in `LUNEDO_DATABASE_URL` owns the database or may create tables, types and indexes in it. Lunedo applies its migrations at every start. |
| Optional right | `CREATEDB` for the monthly test restore of backups, which restores into a temporary database on the same server, for example `ALTER ROLE "lunedo" CREATEDB;`. Without it, a test restore only verifies the backup. See [Backups](backups.md). |
| Free space | Room for one more copy of the database while a test restore runs. |

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
