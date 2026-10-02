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
| `PAGEHALL_LOG_LEVEL` | `info` | | One of `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`. |
| `PAGEHALL_DATABASE_URL` | required | yes | PostgreSQL connection URL, `postgres://user:password@host:5432/database`. |
| `PAGEHALL_DATABASE_POOL_SIZE` | `10` | | Maximum database connections per process. |
| `PAGEHALL_FILES_DIR` | `/var/lib/pagehall/files` | | Directory of the file store. |
| `PAGEHALL_SECRETS_DIR` | `/var/lib/pagehall/secrets` | | Directory for secrets generated on first start. |
| `PAGEHALL_KEY_PROVIDER` | see description | | `env` or `file`. Defaults to `env` when `PAGEHALL_MASTER_KEYS` is set, `file` otherwise. |
| `PAGEHALL_MASTER_KEYS` | none | yes | Master key ring for the env key provider. |
| `PAGEHALL_MASTER_KEYS_PATH` | `master-keys` in the secrets directory | | Master key ring file for the file key provider. |
| `PAGEHALL_BACKUP_KEY` | generated | yes | Key ring that encrypts backups, in the same format as the master keys. |
| `PAGEHALL_METRICS_TOKEN` | generated | yes | Bearer token required by `/metrics`. |
| `PAGEHALL_WEB_ROOT` | `/app/web` in the image | | Directory with the built web client, served by the API. |
| `PAGEHALL_SHUTDOWN_TIMEOUT_SECONDS` | `30` | | Time running requests and jobs get to finish on shutdown. |
| `PAGEHALL_TRUSTED_PROXIES` | none | | Comma-separated IP addresses and CIDR ranges of reverse proxies. Only requests from them may set the client address and protocol through `X-Forwarded-For` and `X-Forwarded-Proto`. |
| `PAGEHALL_PASSWORD_HASH_CONCURRENCY` | `4` | | Password hashes computed at once per process. Each needs about 19 MiB of memory; further sign-ins wait, and beyond a queue of 25 per slot they are rejected with 503. |
| `PAGEHALL_INSECURE_IDENTITY_PROVIDERS` | `false` | | `true` allows identity providers reached without HTTPS, such as a local Keycloak. Only for development and tests; never set it in production. |
| `PAGEHALL_SETUP_CODE` | generated | yes | Setup code for the setup assistant, at least 12 characters not counting spaces and hyphens, at most 64. When set, Pagehall uses it instead of a generated code and does not print it. Ignored once setup is complete. |
| `PAGEHALL_INSTANCE_URL` | none | | Address of the instance, for example `https://wiki.example.org`. Alone, it is used for the setup link in the log and prefills the instance step of the setup assistant. Together with the owner and organization settings, it is part of setup through configuration. |
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

`PAGEHALL_INSTANCE_URL` can also be set on its own. Then it only defines the address: the setup link in the log uses it and the assistant suggests it in the instance step, but setup still runs through the assistant.

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

`GET /metrics` on the API, collaboration and worker ports answers in the Prometheus format when the request carries `Authorization: Bearer <PAGEHALL_METRICS_TOKEN>`. Without a configured token, the generated one is in `metrics-token` in the secrets directory.
