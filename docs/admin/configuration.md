# Configuration

Lunedo reads its configuration from environment variables and, optionally, from a JSON configuration file. Environment variables take precedence over the file; an empty environment variable counts as not set, so the value from the file, or the default, applies. The configuration is validated at startup: an invalid value stops the process with exit code 78 and a message that names the setting. Secret values never appear in these messages.

[Environment variables](environment-variables.md) lists every setting with its default, its allowed values and whether it is a secret. Settings in the admin area, such as sign-in policies or the backup schedule, are stored in the database and described on the pages of their topics.

## Minimum configuration

Only `LUNEDO_DATABASE_URL` is required. For an instance people use, also set:

- `LUNEDO_INSTANCE_URL`, the address people open (or enter it in the setup assistant);
- `LUNEDO_TRUSTED_PROXIES`, the one address of your reverse proxy, when it runs in the Compose project;
- `LUNEDO_MASTER_KEYS` and `LUNEDO_BACKUP_KEY`, or back up the secrets directory where Lunedo generates them.

The [setup script](installation/script.md) writes all of these into `.env`. The variables of the Compose file itself, such as `POSTGRES_PASSWORD`, `LUNEDO_PORT`, `LUNEDO_BIND` and `LUNEDO_SUBNET`, are listed in [Installation with your own Compose file](installation/compose.md#the-env-file).

## Configuration file

`LUNEDO_CONFIG_FILE` points to a JSON object whose keys are the names of the [environment variables](environment-variables.md), with strings, numbers or booleans as values:

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

## Settings by task

The reference groups the environment variables by task:

- [Database and processes](environment-variables.md#database-and-processes): the database connection, ports, log level and shutdown. See [Requirements](requirements.md#database) for the database itself.
- [Address and reverse proxy](environment-variables.md#address-and-reverse-proxy): the instance address, trusted proxies and a separate origin for attachments. See [Instance address](instance-address.md) and [Reverse proxy](reverse-proxy.md#forwarded-headers-and-lunedo_trusted_proxies).
- [Collaboration](environment-variables.md#collaboration): the collaboration server and Redis for several nodes. See [Reverse proxy](reverse-proxy.md#several-nodes).
- [File storage and imports](environment-variables.md#file-storage-and-imports): the file store, S3-compatible storage and the import folder. See [File storage](storage.md) and [Imports](imports.md).
- [Keys and secrets](environment-variables.md#keys-and-secrets): master keys, backup keys and the metrics token. See [Key rings](#key-rings) and [Encryption](encryption.md).
- [Backups](environment-variables.md#backups): the default backup target, the work directory and backups before updates. See [Backups](backups.md) and [Backups before updates](updates.md#backups-before-updates).
- [Updates](environment-variables.md#updates): the update check and the update commands shown in the admin area. See [Update check](updates.md#update-check).
- [Outgoing connections](environment-variables.md#outgoing-connections): private networks Lunedo may reach.
- [Rendering](environment-variables.md#rendering): the optional render container. See [Rendering](rendering.md).
- [Sign-in](environment-variables.md#sign-in): password hashing and identity providers without HTTPS.
- [Setup through configuration](environment-variables.md#setup-through-configuration): the instance, the owner, the first organization and SMTP, set up without the setup assistant. How they work together is described in [Setup through configuration](setup-through-configuration.md); `LUNEDO_INSTANCE_URL` is required for it as well.

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
