# Configuration

Pagehall reads its configuration from environment variables and, optionally, from a JSON configuration file. Environment variables take precedence over the file. The configuration is validated at startup; an invalid value stops the process with exit code 78 and a message that names the setting.

## Configuration file

`PAGEHALL_CONFIG_FILE` points to a JSON object whose keys are the setting names below:

```json
{
  "PAGEHALL_API_PORT": 3000,
  "PAGEHALL_LOG_LEVEL": "info",
  "PAGEHALL_DATABASE_URL_FILE": "/run/secrets/database-url"
}
```

Unknown keys are rejected.

## Secrets

Settings marked as secret can be given in three ways:

1. Directly, for example `PAGEHALL_METRICS_TOKEN=...`.
2. As a file, by appending `_FILE` to the name, for example `PAGEHALL_METRICS_TOKEN_FILE=/run/secrets/metrics-token`. This works with Docker and Kubernetes secrets. A trailing newline is removed. Setting both forms is an error.
3. Generated on first start. The master keys, the backup keys and the metrics token are created in the secrets directory (`master-keys`, `backup-keys`, `metrics-token`) when they are not configured. Generated secrets are never written to logs.

Several nodes can start at the same time on a shared secrets directory; exactly one generated value is kept. In a setup with several nodes and no shared volume, configure all secrets explicitly.

The master keys and the backup keys are needed to read encrypted data and backups. Back up the secrets directory, or the values you configured, separately from the backups.

## Settings

| Setting | Default | Secret | Description |
|---|---|---|---|
| `PAGEHALL_CONFIG_FILE` | none | | Path of an optional JSON configuration file. |
| `PAGEHALL_HOST` | `0.0.0.0` | | Address the HTTP servers listen on. |
| `PAGEHALL_API_PORT` | `3000` | | Port of the API. |
| `PAGEHALL_COLLAB_PORT` | `3001` | | Port of the collaboration server. |
| `PAGEHALL_WORKER_PORT` | `3002` | | Port of the worker's health and metrics endpoints. |
| `PAGEHALL_COLLAB_UPSTREAM` | `http://127.0.0.1:` and the collaboration port | | Address of the collaboration server that the API forwards `/collab` to. See [collaboration.md](collaboration.md). |
| `PAGEHALL_REDIS_URL` | | yes | Redis connection URL (`redis://` or `rediss://`). Needed only when more than one collaboration server runs; see [collaboration.md](collaboration.md). |
| `PAGEHALL_LOG_LEVEL` | `info` | | One of `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`. |
| `PAGEHALL_DATABASE_URL` | required | yes | PostgreSQL connection URL, `postgres://user:password@host:5432/database`. |
| `PAGEHALL_DATABASE_POOL_SIZE` | `10` | | Maximum database connections per process. |
| `PAGEHALL_FILES_DIR` | `/var/lib/pagehall/files` | | Directory of the file store. |
| `PAGEHALL_IMPORT_DIR` | `/data/import` | | Import folder for large exports. Each organization has a subfolder named after its ID, for example `/data/import/0c9d6a3e-5f2b-4c1a-9e8d-7b6a5c4d3e2f`, shown with a copy button in the import wizard; its administrators can import files placed directly inside it. Symbolic links, further subfolders and files at the top level are ignored. Mount it read-only. |
| `PAGEHALL_FILE_STORAGE` | `local` | | Where attachments are stored: `local` in the file store directory, or `s3` in S3-compatible object storage. Attachments are encrypted in both cases. |
| `PAGEHALL_S3_BUCKET` | none | | Bucket for attachments; required when the file storage is `s3`. |
| `PAGEHALL_S3_ENDPOINT` | none | | Address of the S3-compatible service, for example `https://minio.example.org`. Leave it out for Amazon S3. |
| `PAGEHALL_S3_REGION` | `us-east-1` | | Region of the bucket. |
| `PAGEHALL_S3_ACCESS_KEY_ID` | none | yes | Access key ID for the bucket. Without it, the usual AWS credential sources apply. |
| `PAGEHALL_S3_SECRET_ACCESS_KEY` | none | yes | Secret access key for the bucket. |
| `PAGEHALL_S3_FORCE_PATH_STYLE` | `false` | | `true` addresses the bucket in the path instead of the host name, as MinIO and some other services need. |
| `PAGEHALL_S3_PREFIX` | empty | | Prefix for all object names, ending with `/`, for example `pagehall/`. |
| `PAGEHALL_FILES_URL` | none | | Separate origin, such as `https://files.wiki.example.org`, that serves attachment content and previews as an additional isolation layer. It must forward to the API. Attachments are isolated without it as well. |
| `PAGEHALL_SECRETS_DIR` | `/var/lib/pagehall/secrets` | | Directory for secrets generated on first start. |
| `PAGEHALL_KEY_PROVIDER` | see description | | `env` or `file`. Defaults to `env` when `PAGEHALL_MASTER_KEYS` is set, `file` otherwise. |
| `PAGEHALL_MASTER_KEYS` | none | yes | Master key ring for the env key provider. |
| `PAGEHALL_MASTER_KEYS_PATH` | `master-keys` in the secrets directory | | Master key ring file for the file key provider. |
| `PAGEHALL_BACKUP_KEY` | generated | yes | Key ring that encrypts backups, in the same format as the master keys. |
| `PAGEHALL_BACKUP_DIR` | `/var/lib/pagehall/backups` | | Default local backup target. Backups before updates go here while no target is set up in the backup settings. See [backup.md](backup.md). |
| `PAGEHALL_WORK_DIR` | `/var/lib/pagehall/work` | | Private directory (mode 0700) for temporary files of backups and test restores. A running backup stages its database dump here, encrypted under a key that exists only in memory, so neither a crash nor another account can read it; a test restore puts its copy of the file store here. It must not overlap with the backup directory, a backup target, the file store, the secrets or the import folder. It needs free space for the database and, during a test restore, for the file store. Leftovers of interrupted runs are removed at start. |
| `PAGEHALL_BACKUP_BEFORE_UPDATE` | `true` | | `false` starts without a backup when migrations are pending, for installations with their own backup strategy. The backup settings and the status show that it is off. |
| `PAGEHALL_METRICS_TOKEN` | generated | yes | Bearer token required by `/metrics`. |
| `PAGEHALL_RENDER_URL` | none | | Address of the optional render container that creates PDF files on the server, for example `http://pagehall-render:3000`. Set it together with `PAGEHALL_RENDER_TOKEN`; see [rendering.md](rendering.md). |
| `PAGEHALL_RENDER_TOKEN` | none | yes | Token the worker and the API send to the render container, at least 32 characters. Must be the same as `RENDER_TOKEN` of the container. |
| `PAGEHALL_WEB_ROOT` | `/app/web` in the image | | Directory with the built web client, served by the API. |
| `PAGEHALL_SHUTDOWN_TIMEOUT_SECONDS` | `30` | | Time running requests and jobs get to finish on shutdown. |
| `PAGEHALL_UPDATE_CHECK` | `true` | | `false` turns the update check off completely: no request is made, and the instance setting **Check for updates** cannot turn it on. See [operations.md](operations.md#updates). |
| `PAGEHALL_UPDATE_CHECK_URL` | the version file of the latest GitHub release | | Address of the version file, for example a mirror in the company network. A private address must be listed in `PAGEHALL_OUTBOUND_ALLOWED_NETWORKS`. |
| `PAGEHALL_CHANGELOG_FILE` | `/app/CHANGELOG.md` in the image | | Changelog shown under **What's new**. |
| `PAGEHALL_INSTALL_METHOD` | none | | `script`, `compose` or `other`: how the instance was installed. The setup script sets it; the admin area shows the update commands for it. |
| `PAGEHALL_INSTALL_DIR` | none | | Directory of the installation on the host, used in the update commands. The setup script sets it. |
| `PAGEHALL_TRUSTED_PROXIES` | none | | Comma-separated IP addresses and CIDR ranges of reverse proxies. Only requests from them may set the client address and protocol through `X-Forwarded-For` and `X-Forwarded-Proto`. |
| `PAGEHALL_OUTBOUND_ALLOWED_NETWORKS` | none | | Comma-separated IP addresses and CIDR ranges in private networks that chat channels, Confluence imports and the S3 backup target may reach, for example a Matrix server or a MinIO in the local network. Requests to private, loopback and link-local addresses are refused otherwise, also after redirects and when a host name resolves to such an address. Addresses in these ranges may also use `http://`. |
| `PAGEHALL_PASSWORD_HASH_CONCURRENCY` | `4` | | Password hashes computed at once per process. Each needs about 19 MiB of memory; further sign-ins wait, and beyond a queue of 25 per slot they are rejected with 503. |
| `PAGEHALL_INSECURE_IDENTITY_PROVIDERS` | `false` | | `true` allows identity providers reached without HTTPS, such as a local Keycloak. Only for development and tests; never set it in production. |
| `PAGEHALL_SETUP_CODE` | generated | yes | Setup code for the setup assistant, at least 12 characters not counting spaces and hyphens, at most 64. When set, Pagehall uses it instead of a generated code and does not print it. Ignored once setup is complete. |
| `PAGEHALL_INSTANCE_URL` | none | | Address of the instance, for example `https://wiki.example.org`. When set, it is the address: Pagehall stores it at every start, and the setup assistant and the instance settings show it read-only. Together with the owner and organization settings, it is part of setup through configuration. |
| `PAGEHALL_INSTANCE_NAME` | `Pagehall` | | Setup through configuration: name of the instance. |
| `PAGEHALL_OWNER_EMAIL` | none | | Setup through configuration: e-mail address of the owner account. |
| `PAGEHALL_OWNER_NAME` | none | | Setup through configuration: name of the owner account. |
| `PAGEHALL_OWNER_PASSWORD` | none | yes | Setup through configuration: password of the owner account. |
| `PAGEHALL_ORGANIZATION_NAME` | none | | Setup through configuration: name of the first organization. |
| `PAGEHALL_ORGANIZATION_LANGUAGE` | `en` | | Setup through configuration: language of the first organization, `en` or `de`. |
| `PAGEHALL_ORGANIZATION_TIME_ZONE` | `UTC` | | Setup through configuration: IANA time zone of the first organization. |
| `PAGEHALL_SMTP_HOST` | none | | Setup through configuration: SMTP server for outgoing e-mail. |
| `PAGEHALL_SMTP_PORT` | `587`, `465` with `tls` | | Setup through configuration: SMTP port. |
| `PAGEHALL_SMTP_SECURITY` | `starttls` | | Setup through configuration: `tls`, `starttls` or `none`. `none` cannot be combined with credentials. |
| `PAGEHALL_SMTP_USERNAME` | none | | Setup through configuration: SMTP user name. |
| `PAGEHALL_SMTP_PASSWORD` | none | yes | Setup through configuration: SMTP password. |
| `PAGEHALL_SMTP_FROM` | none | | Setup through configuration: sender address. |

## Setup through configuration

On the first start, Pagehall opens a setup assistant that is protected by a one-time setup code, either from `PAGEHALL_SETUP_CODE` or from the container log (see [setup.md](setup.md)). For automated deployments, the setup values can be given through configuration instead: `PAGEHALL_INSTANCE_URL`, `PAGEHALL_OWNER_EMAIL`, `PAGEHALL_OWNER_NAME`, `PAGEHALL_OWNER_PASSWORD` and `PAGEHALL_ORGANIZATION_NAME` are required together, the instance name and the SMTP settings are optional. When they are set, the first API node that starts applies them, the assistant is skipped and no setup code is printed. The organization gets the formats the assistant would propose for its language and time zone (see [setup.md](setup.md)).

`PAGEHALL_INSTANCE_URL` can also be set on its own. Then it only defines the address: the setup link in the log uses it and the assistant shows it in the instance step, but setup still runs through the assistant.

Without `PAGEHALL_INSTANCE_URL`, administrators change the address under Settings, Instance, General. Moving to a new address ends every session, passkeys registered under the old address stop working, and the redirect and reply URLs at every identity provider must be updated; the dialog lists these effects before the change. A browser tab still open under the old address shows the new address instead of failing.

The values are applied once. Later changes to these settings have no effect; change the instance in its settings instead. The owner must set up a second factor at the first sign-in. Back up the master keys and the backup keys yourself, because the assistant's key backup step is skipped.

## Key rings

Master keys and backup keys are key rings: one or more versions of a key, one `<version>:<base64 key>` entry per line (or separated by commas in an environment variable). Each key is 32 random bytes. The highest version encrypts new data; older versions stay available to read data and backups created with them. See [encryption.md](encryption.md) for rotation and [backup.md](backup.md) for backup keys.

Generate a key with:

```sh
openssl rand -base64 32
```

## Shutdown

On SIGTERM or SIGINT, Pagehall stops accepting new work and gives running requests and jobs `PAGEHALL_SHUTDOWN_TIMEOUT_SECONDS` to finish. Jobs that are still running then go back to the queue and run again on another worker. Closing connections takes up to 10 seconds more; only after the timeout plus these 10 seconds is the process ended forcibly.

Container orchestrators must therefore allow a stop grace period of at least the timeout plus 10 seconds, otherwise they kill the process while jobs are still being handed back. Docker and Docker Compose default to 10 seconds; set `stop_grace_period` (Compose) or `terminationGracePeriodSeconds` (Kubernetes) accordingly. The Compose files use 45 seconds for the default timeout of 30 seconds.

## Metrics

`GET /metrics` on the API, collaboration and worker ports answers in the Prometheus format when the request carries `Authorization: Bearer <PAGEHALL_METRICS_TOKEN>`. Without a configured token, the generated one is in `metrics-token` in the secrets directory. [operations.md](operations.md#metrics) lists every metric.
