# Environment variables

This page is generated from `packages/server/src/config/definitions.ts` by `pnpm docs:generate`. Do not edit it by hand; change the code and run the command again.

Every environment variable Lunedo reads, grouped by task. The [configuration file](configuration.md#configuration-file) takes the same names as keys. A secret can be given directly or, with `_FILE` appended to its name, as the path of a file that holds it; see [Secrets](configuration.md#secrets).

## Database and processes

| Variable | Default | Allowed values | Secret | Description |
|---|---|---|---|---|
| `LUNEDO_DATABASE_URL` | required | A `postgres://` URL, for example `postgres://user:password@host:5432/database`. | yes, also as `LUNEDO_DATABASE_URL_FILE` | PostgreSQL connection URL. |
| `LUNEDO_DATABASE_POOL_SIZE` | twice the number of CPUs plus 2, at least 6 and at most 24; with several API processes each of them gets this number divided by their count, at least 8 | A whole number of at least 1. |  | Maximum database connections in the pool of each process. The worker, the collaboration server and every API process each have a pool; each process also holds one connection for notifications, and the worker up to four and every API process one for the job queue. |
| `LUNEDO_SEARCH_SLOTS` | one less than the number of CPUs, at least 1 and at most 4 | A whole number from 1 to 64. |  | Searches that run in PostgreSQL at once, for all API processes and containers together. Further searches wait without holding a database connection. |
| `LUNEDO_SEARCH_WAIT_SECONDS` | `2` | A number from 1 to 30. |  | How long a search waits for a free slot before it is answered with `429` and `Retry-After`. |
| `LUNEDO_SEARCH_TIMEOUT_SECONDS` | `5` | A number from 1 to 300. |  | Longest time one search statement may run in PostgreSQL before it is cancelled. |
| `LUNEDO_API_PROCESSES` | the number of CPUs, at most 8 | A whole number from 1 to 64. |  | Number of API processes. Requests are spread over them, so the API can use more than one CPU. Each process has its own database pool. |
| `LUNEDO_HOST` | `0.0.0.0` |  |  | Address the HTTP servers listen on. |
| `LUNEDO_API_PORT` | `3000` | A whole number from 1 to 65,535. |  | Port of the API. |
| `LUNEDO_COLLAB_PORT` | `3001` | A whole number from 1 to 65,535. |  | Port of the collaboration server. |
| `LUNEDO_WORKER_PORT` | `3002` | A whole number from 1 to 65,535. |  | Port of the worker's health and metrics endpoints. |
| `LUNEDO_LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`. |  | Minimum level of the messages Lunedo logs. |
| `LUNEDO_SHUTDOWN_TIMEOUT_SECONDS` | `30` | A whole number of at least 1. |  | Time in seconds that running requests and jobs get to finish on shutdown. Allow a stop grace period of at least this time plus 10 seconds in the container orchestrator. |
| `LUNEDO_JOB_CONCURRENCY` | the number of CPUs | Comma-separated `queue=number` pairs with numbers from 1 to 64, for example `search.update-index=8,files.create-display-versions=2`. |  | Jobs that one worker process runs at once in the queues `search.update-index` (search index updates) and `files.create-display-versions` (display versions of images). A queue that is not listed runs as many at once as the process has CPUs. |
| `LUNEDO_WEB_ROOT` | `/app/web` in the image |  |  | Directory with the built web client, served by the API. |
| `LUNEDO_CONFIG_FILE` | none |  |  | Path of an optional JSON configuration file. Its keys are the names of these settings; environment variables take precedence over it. |

## Address and reverse proxy

| Variable | Default | Allowed values | Secret | Description |
|---|---|---|---|---|
| `LUNEDO_INSTANCE_URL` | none | An `http://` or `https://` address without a path or a trailing slash, for example `https://wiki.example.com`. |  | Address of the instance, used for the setup link and for setup through configuration. When set, it is the address: Lunedo stores it at every start, and the setup assistant and the instance settings show it read-only. |
| `LUNEDO_TRUSTED_PROXIES` | none | Comma-separated IP addresses and CIDR ranges. |  | Reverse proxies whose forwarding headers are trusted. Only requests from them may set the client address, protocol and host through `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host`. List the one address of your proxy, never a whole subnet. |
| `LUNEDO_FILES_URL` | none | An `http://` or `https://` address without a path. |  | Separate origin, such as `https://files.wiki.example.com`, that serves attachment content and previews as an additional isolation layer. The reverse proxy must forward it to the API. Attachments are isolated without it as well. |

## Collaboration

| Variable | Default | Allowed values | Secret | Description |
|---|---|---|---|---|
| `LUNEDO_COLLAB_UPSTREAM` | `http://127.0.0.1:` and the collaboration port | An `http://` or `https://` address without a path. |  | Address of the collaboration server that the API forwards `/collab` to. |
| `LUNEDO_REDIS_URL` | none | A `redis://` or `rediss://` URL. | yes, also as `LUNEDO_REDIS_URL_FILE` | Redis connection URL. Collaboration servers synchronize documents through it; it is needed only when more than one collaboration server runs, and then on every collaboration node. Any Redis-compatible server works, for example Valkey. |

## File storage and imports

| Variable | Default | Allowed values | Secret | Description |
|---|---|---|---|---|
| `LUNEDO_FILES_DIR` | `/var/lib/lunedo/files` |  |  | Directory of the file store. |
| `LUNEDO_FILE_STORAGE` | `local` | `local` or `s3`. |  | Where attachments are stored: `local` in the file store directory, or `s3` in S3-compatible object storage. Attachments are encrypted in both cases. |
| `LUNEDO_S3_BUCKET` | none |  |  | Bucket for attachments; required when the file storage is `s3`. |
| `LUNEDO_S3_ENDPOINT` | none | An `http://` or `https://` address. |  | Address of the S3-compatible service, for example `https://s3.example.com`. Leave it out for Amazon S3. |
| `LUNEDO_S3_REGION` | `us-east-1` |  |  | Region of the bucket. |
| `LUNEDO_S3_ACCESS_KEY_ID` | none |  | yes, also as `LUNEDO_S3_ACCESS_KEY_ID_FILE` | Access key ID for the bucket. Without it, the usual AWS credential sources apply. Set it together with the secret access key. |
| `LUNEDO_S3_SECRET_ACCESS_KEY` | none |  | yes, also as `LUNEDO_S3_SECRET_ACCESS_KEY_FILE` | Secret access key for the bucket. |
| `LUNEDO_S3_FORCE_PATH_STYLE` | `false` | `true` or `false`. |  | `true` addresses the bucket in the path instead of the host name, as MinIO and some other services need. |
| `LUNEDO_S3_PREFIX` | empty | Empty, or names of letters, digits, `.`, `_` and `-`, each followed by `/`. |  | Prefix for all object names, for example `lunedo/`. |
| `LUNEDO_IMPORT_DIR` | `/data/import` |  |  | Import folder for large exports. Each organization has a subfolder named after its ID, shown with a copy button in the import wizard. Files placed directly inside it can be imported without uploading them. Symbolic links, further subfolders and files at the top level are ignored. Mount it read-only. |

## Keys and secrets

| Variable | Default | Allowed values | Secret | Description |
|---|---|---|---|---|
| `LUNEDO_SECRETS_DIR` | `/var/lib/lunedo/secrets` |  |  | Directory for secrets generated on first start: the master keys, the backup keys and the metrics token. Back it up separately from the backups. |
| `LUNEDO_KEY_PROVIDER` | `env` when `LUNEDO_MASTER_KEYS` is set, `file` otherwise | `env` or `file`. |  | Source of the master keys. |
| `LUNEDO_MASTER_KEYS` | none |  | yes, also as `LUNEDO_MASTER_KEYS_FILE` | Master key ring for the `env` key provider: one `<version>:<base64 key>` entry per line, or separated by commas. Each key is 32 random bytes; the highest version encrypts new data. |
| `LUNEDO_MASTER_KEYS_PATH` | `master-keys` in the secrets directory |  |  | Master key ring file for the `file` key provider. |
| `LUNEDO_BACKUP_KEY` | generated in the secrets directory |  | yes, also as `LUNEDO_BACKUP_KEY_FILE` | Key ring that encrypts backups, in the same format as the master keys. |
| `LUNEDO_METRICS_TOKEN` | generated in the secrets directory |  | yes, also as `LUNEDO_METRICS_TOKEN_FILE` | Bearer token required by `/metrics`. |

## Backups

| Variable | Default | Allowed values | Secret | Description |
|---|---|---|---|---|
| `LUNEDO_BACKUP_DIR` | `/var/lib/lunedo/backups` |  |  | Default local backup target. Backups before updates go here while no target is set up in the backup settings. |
| `LUNEDO_WORK_DIR` | `/var/lib/lunedo/work` |  |  | Private directory (mode 0700) for temporary files of backups and test restores. A running backup stages its database dump here, encrypted under a key that exists only in memory; a test restore puts its copy of the file store here. It must not overlap with the backup directory, the file store, the secrets directory or the import folder, and no backup target may lie inside it. It needs free space for the database and, during a test restore, for the file store. |
| `LUNEDO_BACKUP_BEFORE_UPDATE` | `true` | `true` or `false`. |  | `false` starts without a backup when migrations are pending, for installations with their own backup strategy. The backup settings and the status show that it is off. |

## Updates

| Variable | Default | Allowed values | Secret | Description |
|---|---|---|---|---|
| `LUNEDO_UPDATE_CHECK` | `true` | `true` or `false`. |  | `false` turns the update check off completely: Lunedo then makes no request for it, and the instance setting cannot turn it on. |
| `LUNEDO_UPDATE_CHECK_URL` | `https://github.com/lunedo/lunedo/releases/latest/download/lunedo-versions.json` | An `http://` or `https://` address without a user name, password, query string or fragment. |  | Address of the version file the update check downloads, for example a mirror inside the company network. A private address must be listed in `LUNEDO_OUTBOUND_ALLOWED_NETWORKS`; a public one must use HTTPS. |
| `LUNEDO_CHANGELOG_FILE` | `/app/CHANGELOG.md` in the image, `CHANGELOG.md` of the source tree otherwise |  |  | Path of the changelog shown under What's new. |
| `LUNEDO_INSTALL_METHOD` | none | `script`, `compose` or `other`. |  | How the instance was installed: `script` for the setup script, `compose` for a Compose file of your own, `other` for anything else. The setup script sets it; the admin area shows the update commands for it. |
| `LUNEDO_INSTALL_DIR` | none |  |  | Directory on the host that holds the installation, shown in the update commands. The setup script sets it. |

## Outgoing connections

| Variable | Default | Allowed values | Secret | Description |
|---|---|---|---|---|
| `LUNEDO_OUTBOUND_ALLOWED_NETWORKS` | none | Comma-separated IP addresses and CIDR ranges. |  | Private networks that Lunedo may reach for chat channels, Confluence imports, the S3 backup target, the S3 restore in the setup assistant and the update check, for example a Matrix server or a MinIO in the local network. Requests to private, loopback and link-local addresses are refused otherwise, also after redirects and when a host name resolves to such an address. Addresses in these ranges may also use `http://`; public addresses need `https://`. |

## Rendering

| Variable | Default | Allowed values | Secret | Description |
|---|---|---|---|---|
| `LUNEDO_RENDER_URL` | none | An `http://` or `https://` address without a path. |  | Address of the optional render container that creates PDF files on the server, for example `http://lunedo-render:3000`. Set it together with `LUNEDO_RENDER_TOKEN`. |
| `LUNEDO_RENDER_TOKEN` | none | Text of at least 32 characters. | yes, also as `LUNEDO_RENDER_TOKEN_FILE` | Token the worker sends to the render container. Must be the same as `RENDER_TOKEN` of the container. |

## Sign-in

| Variable | Default | Allowed values | Secret | Description |
|---|---|---|---|---|
| `LUNEDO_PASSWORD_HASH_CONCURRENCY` | `4` | A whole number from 1 to 64. |  | Password hashes computed at once per process. Each needs about 19 MiB of memory; further sign-ins wait, and beyond a queue of 25 per slot they are rejected with `503`. |
| `LUNEDO_INSECURE_IDENTITY_PROVIDERS` | `false` | `true` or `false`. |  | `true` allows identity providers reached without HTTPS, such as a local Keycloak. Only for development and tests; never set it in production. |

## Setup through configuration

| Variable | Default | Allowed values | Secret | Description |
|---|---|---|---|---|
| `LUNEDO_SETUP_CODE` | generated | At least 12 characters not counting spaces and hyphens, at most 64. | yes, also as `LUNEDO_SETUP_CODE_FILE` | Setup code for the setup assistant. When set, Lunedo uses it instead of a generated code and does not print it. Ignored once setup is complete. |
| `LUNEDO_INSTANCE_NAME` | `Lunedo` |  |  | Name of the instance for setup through configuration. |
| `LUNEDO_OWNER_EMAIL` | none | An e-mail address. |  | E-mail address of the owner account for setup through configuration. |
| `LUNEDO_OWNER_NAME` | none |  |  | Name of the owner account for setup through configuration. |
| `LUNEDO_OWNER_PASSWORD` | none |  | yes, also as `LUNEDO_OWNER_PASSWORD_FILE` | Password of the owner account for setup through configuration. |
| `LUNEDO_ORGANIZATION_NAME` | none |  |  | Name of the first organization for setup through configuration. |
| `LUNEDO_ORGANIZATION_LANGUAGE` | the language of the instance | `en` or `de`. |  | Language of the first organization for setup through configuration. |
| `LUNEDO_ORGANIZATION_TIME_ZONE` | the time zone of the instance | An IANA time zone, for example `Europe/Vienna`. |  | Time zone of the first organization for setup through configuration. |
| `LUNEDO_SMTP_HOST` | none |  |  | SMTP server for outgoing e-mail, for setup through configuration. |
| `LUNEDO_SMTP_PORT` | `587`, `465` with `tls` | A whole number from 1 to 65,535. |  | SMTP port for setup through configuration. |
| `LUNEDO_SMTP_SECURITY` | `starttls` | `tls`, `starttls` or `none`. |  | SMTP connection security for setup through configuration. `none` cannot be combined with credentials. |
| `LUNEDO_SMTP_USERNAME` | none |  |  | SMTP user name for setup through configuration. Set it together with the password. |
| `LUNEDO_SMTP_PASSWORD` | none |  | yes, also as `LUNEDO_SMTP_PASSWORD_FILE` | SMTP password for setup through configuration. |
| `LUNEDO_SMTP_FROM` | none | An e-mail address. |  | Sender address for setup through configuration. |
