# Configuration

Lunedo reads its configuration from environment variables and, optionally, from a JSON configuration file. Environment variables take precedence over the file; an empty environment variable counts as not set, so the value from the file, or the default, applies. The configuration is validated at startup: an invalid value stops the process with exit code 78 and a message that names the setting. Secret values never appear in these messages.

The settings below are grouped by task. Settings in the admin area, such as sign-in policies or the backup schedule, are stored in the database and described on the pages of their topics.

## Minimum configuration

Only `LUNEDO_DATABASE_URL` is required. For an instance people use, also set:

- `LUNEDO_INSTANCE_URL`, the address people open (or enter it in the setup assistant);
- `LUNEDO_TRUSTED_PROXIES`, the one address of your reverse proxy, when it runs in the Compose project;
- `LUNEDO_MASTER_KEYS` and `LUNEDO_BACKUP_KEY`, or back up the secrets directory where Lunedo generates them.

The [setup script](installation/script.md) writes all of these into `.env`. The variables of the Compose file itself, such as `POSTGRES_PASSWORD`, `LUNEDO_PORT`, `LUNEDO_BIND` and `LUNEDO_SUBNET`, are listed in [Installation with your own Compose file](installation/compose.md#the-env-file).

## Configuration file

`LUNEDO_CONFIG_FILE` points to a JSON object whose keys are the setting names below, with strings, numbers or booleans as values:

```json
{
  "LUNEDO_API_PORT": 3000,
  "LUNEDO_LOG_LEVEL": "info",
  "LUNEDO_DATABASE_URL_FILE": "/run/secrets/database-url"
}
```

Unknown keys are rejected.

## Secrets

Settings marked as secret can be given in three ways:

1. Directly, for example `LUNEDO_METRICS_TOKEN=...`.
2. As a file, by appending `_FILE` to the name, for example `LUNEDO_METRICS_TOKEN_FILE=/run/secrets/metrics-token`. This works with Docker and Kubernetes secrets. A trailing newline is removed. Setting both forms is an error.
3. Generated on first start. The master keys, the backup keys and the metrics token are created in the secrets directory (`master-keys`, `backup-keys`, `metrics-token`) when they are not configured. Generated secrets are never written to logs.

Several nodes can start at the same time on a shared secrets directory; exactly one generated value is kept. In a setup with several nodes and no shared volume, configure all secrets explicitly.

The master keys and the backup keys are needed to read encrypted data and backups. Back up the secrets directory, or the values you configured, separately from the backups.

## Database and processes

| Setting | Default | Secret | Description |
|---|---|---|---|
| `LUNEDO_DATABASE_URL` | required | yes | PostgreSQL connection URL, `postgres://user:password@host:5432/database`. See [Requirements](requirements.md#database). |
| `LUNEDO_DATABASE_POOL_SIZE` | `10` | | Maximum database connections per process. |
| `LUNEDO_HOST` | `0.0.0.0` | | Address the HTTP servers listen on. |
| `LUNEDO_API_PORT` | `3000` | | Port of the API. |
| `LUNEDO_COLLAB_PORT` | `3001` | | Port of the collaboration server. |
| `LUNEDO_WORKER_PORT` | `3002` | | Port of the worker's health and metrics endpoints. |
| `LUNEDO_LOG_LEVEL` | `info` | | One of `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`. |
| `LUNEDO_SHUTDOWN_TIMEOUT_SECONDS` | `30` | | Time running requests and jobs get to finish on shutdown. See [Shutdown](#shutdown). |
| `LUNEDO_WEB_ROOT` | `/app/web` in the image | | Directory with the built web client, served by the API. |
| `LUNEDO_CONFIG_FILE` | none | | Path of an optional JSON configuration file. |

## Address and reverse proxy

| Setting | Default | Secret | Description |
|---|---|---|---|
| `LUNEDO_INSTANCE_URL` | none | | Address of the instance, for example `https://wiki.example.com`, with `http://` or `https://` and without a path or a trailing slash. When set, it is the address: Lunedo stores it at every start, and the setup assistant and the instance settings show it read-only. See [Instance address](instance-address.md). |
| `LUNEDO_TRUSTED_PROXIES` | none | | Comma-separated IP addresses and CIDR ranges of reverse proxies. Only requests from them may set the client address, protocol and host through `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host`. List the one address of your proxy, never a whole subnet. See [Reverse proxy](reverse-proxy.md#forwarded-headers-and-lunedo_trusted_proxies). |
| `LUNEDO_FILES_URL` | none | | Separate origin, such as `https://files.wiki.example.com`, that serves attachment content and previews as an additional isolation layer. An `http://` or `https://` address without a path. The reverse proxy must forward it to the API. Attachments are isolated without it as well. |

## Collaboration

| Setting | Default | Secret | Description |
|---|---|---|---|
| `LUNEDO_COLLAB_UPSTREAM` | `http://127.0.0.1:` and the collaboration port | | Address of the collaboration server that the API forwards `/collab` to. An `http://` or `https://` address without a path. See [Reverse proxy](reverse-proxy.md#several-nodes). |
| `LUNEDO_REDIS_URL` | none | yes | Redis connection URL (`redis://` or `rediss://`). Needed only when more than one collaboration server runs; set it on every collaboration node. Any Redis-compatible server works, for example Valkey. |

## File storage and imports

| Setting | Default | Secret | Description |
|---|---|---|---|
| `LUNEDO_FILES_DIR` | `/var/lib/lunedo/files` | | Directory of the file store. |
| `LUNEDO_FILE_STORAGE` | `local` | | Where attachments are stored: `local` in the file store directory, or `s3` in S3-compatible object storage. Attachments are encrypted in both cases. See [File storage](storage.md). |
| `LUNEDO_S3_BUCKET` | none | | Bucket for attachments; required when the file storage is `s3`. |
| `LUNEDO_S3_ENDPOINT` | none | | Address of the S3-compatible service, for example `https://s3.example.com`. Leave it out for Amazon S3. |
| `LUNEDO_S3_REGION` | `us-east-1` | | Region of the bucket. |
| `LUNEDO_S3_ACCESS_KEY_ID` | none | yes | Access key ID for the bucket. Without it, the usual AWS credential sources apply. Set together with the secret access key. |
| `LUNEDO_S3_SECRET_ACCESS_KEY` | none | yes | Secret access key for the bucket. |
| `LUNEDO_S3_FORCE_PATH_STYLE` | `false` | | `true` addresses the bucket in the path instead of the host name, as MinIO and some other services need. |
| `LUNEDO_S3_PREFIX` | empty | | Prefix for all object names, ending with `/`, for example `lunedo/`. |
| `LUNEDO_IMPORT_DIR` | `/data/import` | | Import folder for large exports. Each organization has a subfolder named after its ID, for example `/data/import/0c9d6a3e-5f2b-4c1a-9e8d-7b6a5c4d3e2f`, shown with a copy button in the import wizard. Files placed directly inside it can be imported without uploading them. Symbolic links, further subfolders and files at the top level are ignored. Mount it read-only. See [Imports](imports.md). |

## Keys and secrets

| Setting | Default | Secret | Description |
|---|---|---|---|
| `LUNEDO_SECRETS_DIR` | `/var/lib/lunedo/secrets` | | Directory for secrets generated on first start. |
| `LUNEDO_KEY_PROVIDER` | see description | | Source of the master keys: `env` or `file`. Defaults to `env` when `LUNEDO_MASTER_KEYS` is set, `file` otherwise. |
| `LUNEDO_MASTER_KEYS` | none | yes | Master key ring for the `env` key provider. See [Key rings](#key-rings). |
| `LUNEDO_MASTER_KEYS_PATH` | `master-keys` in the secrets directory | | Master key ring file for the `file` key provider. |
| `LUNEDO_BACKUP_KEY` | generated | yes | Key ring that encrypts backups, in the same format as the master keys. |
| `LUNEDO_METRICS_TOKEN` | generated | yes | Bearer token required by `/metrics`. See [Metrics](#metrics). |

See [Encryption](encryption.md) for what the keys protect, how to back them up and how to rotate them.

## Backups

| Setting | Default | Secret | Description |
|---|---|---|---|
| `LUNEDO_BACKUP_DIR` | `/var/lib/lunedo/backups` | | Default local backup target. Backups before updates go here while no target is set up in the backup settings. See [Backups](backups.md). |
| `LUNEDO_WORK_DIR` | `/var/lib/lunedo/work` | | Private directory (mode 0700) for temporary files of backups and test restores. A running backup stages its database dump here, encrypted under a key that exists only in memory; a test restore puts its copy of the file store here. It must not overlap with the backup directory, the file store, the secrets directory or the import folder, and no backup target may lie inside it. It needs free space for the database and, during a test restore, for the file store. |
| `LUNEDO_BACKUP_BEFORE_UPDATE` | `true` | | `false` starts without a backup when migrations are pending, for installations with their own backup strategy. The backup settings and the status show that it is off. See [Backups before updates](updates.md#backups-before-updates). |

## Updates

| Setting | Default | Secret | Description |
|---|---|---|---|
| `LUNEDO_UPDATE_CHECK` | `true` | | `false` turns the update check off completely: no request is made, and the instance setting **Check for updates** cannot turn it on. See [Update check](updates.md#update-check). |
| `LUNEDO_UPDATE_CHECK_URL` | the version file of the latest GitHub release | | Address of the version file, for example a mirror in the company network. A private address must be listed in `LUNEDO_OUTBOUND_ALLOWED_NETWORKS`; a public one must use HTTPS. The version file is public, so the address may not contain a user name, a password, a query string or a fragment; Lunedo refuses to start with one. |
| `LUNEDO_CHANGELOG_FILE` | `/app/CHANGELOG.md` in the image | | Changelog shown under **What's new**. |
| `LUNEDO_INSTALL_METHOD` | none | | `script`, `compose` or `other`: how the instance was installed. The setup script sets it; the admin area shows the update commands for it. |
| `LUNEDO_INSTALL_DIR` | none | | Directory of the installation on the host, used in the update commands. The setup script sets it. |

## Outgoing connections

| Setting | Default | Secret | Description |
|---|---|---|---|
| `LUNEDO_OUTBOUND_ALLOWED_NETWORKS` | none | | Comma-separated IP addresses and CIDR ranges in private networks that Lunedo may reach for chat channels, Confluence imports, the S3 backup target, the S3 restore in the setup assistant and the update check, for example a Matrix server or a MinIO in the local network. Requests to private, loopback and link-local addresses are refused otherwise, also after redirects and when a host name resolves to such an address. Addresses in these ranges may also use `http://`; public addresses need `https://`. |

## Rendering

| Setting | Default | Secret | Description |
|---|---|---|---|
| `LUNEDO_RENDER_URL` | none | | Address of the optional render container that creates PDF files on the server, for example `http://lunedo-render:3000`, without a path. Set it together with `LUNEDO_RENDER_TOKEN`; see [Rendering](rendering.md). |
| `LUNEDO_RENDER_TOKEN` | none | yes | Token Lunedo sends to the render container, at least 32 characters. Must be the same as `RENDER_TOKEN` of the container. |

## Sign-in

| Setting | Default | Secret | Description |
|---|---|---|---|
| `LUNEDO_PASSWORD_HASH_CONCURRENCY` | `4` | | Password hashes computed at once per process, at most 64. Each needs about 19 MiB of memory; further sign-ins wait, and beyond a queue of 25 per slot they are rejected with `503`. |
| `LUNEDO_INSECURE_IDENTITY_PROVIDERS` | `false` | | `true` allows identity providers reached without HTTPS, such as a local Keycloak. Only for development and tests; never set it in production. |

## Setup through configuration

These settings set up the instance without the setup assistant. How they work together is described in [Setup through configuration](setup-through-configuration.md).

| Setting | Default | Secret | Description |
|---|---|---|---|
| `LUNEDO_SETUP_CODE` | generated | yes | Setup code for the setup assistant, at least 12 characters not counting spaces and hyphens, at most 64. When set, Lunedo uses it instead of a generated code and does not print it. Ignored once setup is complete. See [Setup code](setup-assistant.md#setup-code). |
| `LUNEDO_INSTANCE_NAME` | `Lunedo` | | Name of the instance. |
| `LUNEDO_OWNER_EMAIL` | none | | E-mail address of the owner account. |
| `LUNEDO_OWNER_NAME` | none | | Name of the owner account. |
| `LUNEDO_OWNER_PASSWORD` | none | yes | Password of the owner account. |
| `LUNEDO_ORGANIZATION_NAME` | none | | Name of the first organization. |
| `LUNEDO_ORGANIZATION_LANGUAGE` | the language of the instance | | Language of the first organization, `en` or `de`. |
| `LUNEDO_ORGANIZATION_TIME_ZONE` | the time zone of the instance | | IANA time zone of the first organization. |
| `LUNEDO_SMTP_HOST` | none | | SMTP server for outgoing e-mail. |
| `LUNEDO_SMTP_PORT` | `587`, `465` with `tls` | | SMTP port. |
| `LUNEDO_SMTP_SECURITY` | `starttls` | | `tls`, `starttls` or `none`. `none` cannot be combined with credentials. |
| `LUNEDO_SMTP_USERNAME` | none | | SMTP user name. Set together with the password. |
| `LUNEDO_SMTP_PASSWORD` | none | yes | SMTP password. |
| `LUNEDO_SMTP_FROM` | none | | Sender address. |

`LUNEDO_INSTANCE_URL`, listed under [Address and reverse proxy](#address-and-reverse-proxy), is required for setup through configuration as well.

## Checks at start

Besides the value of each setting, the start fails with exit code 78 when settings do not fit together:

- `LUNEDO_MASTER_KEYS` is set while `LUNEDO_KEY_PROVIDER` is `file`, or `LUNEDO_KEY_PROVIDER` is `env` without `LUNEDO_MASTER_KEYS`.
- `LUNEDO_FILE_STORAGE` is `s3` without `LUNEDO_S3_BUCKET`.
- Only one of `LUNEDO_S3_ACCESS_KEY_ID` and `LUNEDO_S3_SECRET_ACCESS_KEY` is set.
- Only one of `LUNEDO_RENDER_URL` and `LUNEDO_RENDER_TOKEN` is set.
- `LUNEDO_WORK_DIR` overlaps with `LUNEDO_BACKUP_DIR`, `LUNEDO_FILES_DIR`, `LUNEDO_SECRETS_DIR` or `LUNEDO_IMPORT_DIR`.
- Setup or SMTP settings are incomplete; see [Setup through configuration](setup-through-configuration.md#settings).

## Key rings

Master keys and backup keys are key rings: one or more versions of a key, one `<version>:<base64 key>` entry per line (or separated by commas in an environment variable). Each key is 32 random bytes. The highest version encrypts new data; older versions stay available to read data and backups created with them. See [Encryption](encryption.md) for rotation and [Backups](backups.md) for backup keys.

Generate a key with:

```sh
head -c 32 /dev/urandom | base64
```

## Shutdown

On SIGTERM or SIGINT, Lunedo stops accepting new work and gives running requests and jobs `LUNEDO_SHUTDOWN_TIMEOUT_SECONDS` to finish. Jobs that are still running then go back to the queue and run again on another worker. Closing connections takes up to 10 seconds more; only after the timeout plus these 10 seconds is the process ended forcibly.

Container orchestrators must therefore allow a stop grace period of at least the timeout plus 10 seconds, otherwise they kill the process while jobs are still being handed back. Docker and Docker Compose default to 10 seconds; set `stop_grace_period` (Compose) or `terminationGracePeriodSeconds` (Kubernetes) accordingly. The Compose file uses 45 seconds for the default timeout of 30 seconds.

## Metrics

`GET /metrics` on the API, collaboration and worker ports answers in the Prometheus format when the request carries `Authorization: Bearer <LUNEDO_METRICS_TOKEN>`. Without a configured token, the generated one is in `metrics-token` in the secrets directory. [Monitoring](monitoring.md) lists every metric.
