# Monitoring and status

Lunedo offers health endpoints for container orchestration and load balancers, and Prometheus metrics for monitoring. The [system status page](monitoring/system-status.md) shows the same state to people. How to collect the metrics: [Prometheus](monitoring/prometheus.md), [Zabbix](monitoring/zabbix.md).

## Health endpoints

Every process answers on its own port: the API on 3000 (`LUNEDO_API_PORT`), the collaboration server on 3001 (`LUNEDO_COLLAB_PORT`) and the worker on 3002 (`LUNEDO_WORKER_PORT`). In the single container (role `all`), the API port is the one to publish; the other two are reachable inside the container network.

| Endpoint | Answer |
|---|---|
| `GET /health/live` | `200` while the process runs. It runs no checks; use it as the liveness probe. |
| `GET /health/ready` | `200` when the database answers, all migrations are applied and the master key is loaded, otherwise `503` with the failing check. Use it as the readiness probe and for load balancers. |
| `GET /metrics` | Prometheus metrics, with the token described under [Metrics](#metrics). |
| `GET /tls/ask?domain=<domain>` | API only: `200` for a knowledge base portal domain that an instance administrator allowed, `404` otherwise. It is meant for the on-demand TLS of a reverse proxy; see [knowledge-base-portals.md](knowledge-base-portals.md#own-domains). |

All four answer on every host name, also on own domains of knowledge base portals. The answers contain no content and no personal data.

### Limits of `/tls/ask`

`/tls/ask` accepts 120 requests per minute from each client address. Further requests in the same minute get `429` with `Retry-After: 60`. Requests that come straight from a trusted proxy, from an address in `LUNEDO_TRUSTED_PROXIES` or from loopback, without an `X-Forwarded-For` header, are not limited, so the reverse proxy that asks for certificates is never refused.

## Metrics

`/metrics` needs the header `Authorization: Bearer <token>`. The token is `LUNEDO_METRICS_TOKEN`. Without it, Lunedo generates one into the file `metrics-token` in the secrets directory; read it with `docker compose exec lunedo cat /var/lib/lunedo/secrets/metrics-token`. The setup script writes a token into `.env`. A request without the right token gets `401`.

Scrape the API: it exposes the values of the whole instance. The worker and the collaboration server expose the metrics of their own process (HTTP, database pool, job durations, open editors). Every series has the label `service` (`api`, `worker` or `collab`).

No metric has a label with personal data, a page title, a space name or another unbounded value. Labels are fixed names: routes as templates, job queue names, states and the fixed text of log events.

Scrape the address inside the network, not the public address of the reverse proxy, or block `/metrics` on the proxy for everyone else.

### Values of the instance (API)

| Metric | Type | Meaning |
|---|---|---|
| `lunedo_jobs{queue,state}` | gauge | Jobs per queue in the states `queued`, `active`, `deferred` (scheduled for later) and `failed` (failed after all attempts and still kept). |
| `lunedo_collab_up` | gauge | 1 when the collaboration server answers its readiness check, 0 otherwise. |
| `lunedo_mail_delivery_failures_total` | counter | Failed attempts to deliver an e-mail. Each mail is tried up to 9 times. |
| `lunedo_mail_undelivered_total` | counter | E-mails given up after the last attempt. |
| `lunedo_mail_last_success_timestamp_seconds` | gauge | Time of the last delivered e-mail, as a Unix timestamp. |
| `lunedo_mail_last_failure_timestamp_seconds` | gauge | Time of the last failed attempt. Missing until one fails. |
| `lunedo_storage_used_bytes` | gauge | Bytes used in the file store: on the volume for local storage, the running total of stored files for S3. |
| `lunedo_storage_size_bytes` | gauge | Size of the volume, or the configured limit for S3. |
| `lunedo_storage_usage_ratio` | gauge | Used share from 0 to 1. Missing for S3 without a limit. |
| `lunedo_storage_level` | gauge | Active storage warning level: 0 none, 1 warning, 2 large writes paused, 3 critical. See [storage.md](storage.md). |
| `lunedo_database_size_bytes` | gauge | Size of the Lunedo database. |
| `lunedo_backup_last_success_timestamp_seconds` | gauge | Time of the last successful backup. |
| `lunedo_backup_failures_total` | counter | Backups that failed. |
| `lunedo_backup_scheduled` | gauge | 1 when scheduled backups are on and have a target. |
| `lunedo_search_pending_items` | gauge | Items waiting to be indexed for search. |
| `lunedo_search_failing_items` | gauge | Items whose indexing failed at least once and is retried. |
| `lunedo_maintenance_mode` | gauge | 1 while [maintenance mode](maintenance-mode.md) is on. |
| `lunedo_update_available` | gauge | 1 when a newer release is available. Only exposed while the update check is on. |

Values that are not known are left out instead of reported as 0, for example the storage usage of S3 without a limit. The values are read from the database at most every 10 seconds.

### Values of each process

The API reports its processes together: counters and histograms are summed over them, and the values read from the database appear once.

| Metric | Type | Meaning |
|---|---|---|
| `lunedo_build_info{version}` | gauge | Always 1; `version` is the running version. |
| `lunedo_http_requests_total{method,route,status}` | counter | HTTP requests by route template. |
| `lunedo_http_request_duration_seconds{method,route,status}` | histogram | Request latency. |
| `lunedo_job_duration_seconds{queue,state}` | histogram | Duration of job attempts on this worker, by outcome. |
| `lunedo_db_pool_connections{state}` | gauge | Database connections of this process, for the API of all its processes together: `total`, `idle`, `waiting`. |
| `lunedo_db_pool_acquire_seconds` | histogram | Time a query waited for a free database connection. |
| `lunedo_db_pool_acquire_timeouts_total` | counter | Queries that gave up waiting for a connection and failed. |
| `lunedo_log_errors_total{type}` | counter | Error-level log events by their fixed text, the same as under [Recent errors](monitoring/system-status.md#recent-errors). |
| `lunedo_collab_connections` | gauge | Open editor connections (collaboration server). |
| `lunedo_collab_documents` | gauge | Documents the collaboration server holds open. |

The default metrics of Node.js (`process_*`, `nodejs_*`) come with every process.
