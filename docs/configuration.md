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
3. Generated on first start. The master keys, the backup key and the metrics token are created in the secrets directory when they are not configured. Generated secrets are never written to logs.

Several nodes can start at the same time on a shared secrets directory; exactly one generated value is kept. In a setup with several nodes and no shared volume, configure all secrets explicitly.

The master keys and the backup key are needed to read encrypted data and backups. Back up the secrets directory, or the values you configured, separately from the backups.

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
| `PAGEHALL_BACKUP_KEY` | generated | yes | Key that encrypts backups: 32 bytes, base64. |
| `PAGEHALL_METRICS_TOKEN` | generated | yes | Bearer token required by `/metrics`. |
| `PAGEHALL_WEB_ROOT` | `/app/web` in the image | | Directory with the built web client, served by the API. |
| `PAGEHALL_SHUTDOWN_TIMEOUT_SECONDS` | `30` | | Time running requests and jobs get to finish on shutdown. |

## Master keys

A key ring holds one or more versions of the master key, one `<version>:<base64 key>` entry per line (or separated by commas in `PAGEHALL_MASTER_KEYS`). Each key is 32 random bytes. The highest version encrypts new data; older versions stay available to read data that has not been rotated yet. See [encryption.md](encryption.md) for rotation.

Generate a key with:

```sh
openssl rand -base64 32
```

## Metrics

`GET /metrics` on the API, collaboration and worker ports answers in the Prometheus format when the request carries `Authorization: Bearer <PAGEHALL_METRICS_TOKEN>`. Without a configured token, the generated one is in `metrics-token` in the secrets directory.
