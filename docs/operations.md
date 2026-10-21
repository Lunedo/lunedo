# Operations

How to watch a running instance: health endpoints, metrics, the system status page, maintenance mode and updates. Installing and updating are in [setup.md](setup.md), reverse proxies in [reverse-proxy.md](reverse-proxy.md), backups in [backup.md](backup.md).

## Health endpoints

Every process answers on its own port (API 3000, collaboration server 3001, worker 3002). In the single container (`all`), the API port is the one to publish; the other two are reachable inside the container network.

| Endpoint | Answer |
|---|---|
| `GET /health/live` | `200` while the process runs. It runs no checks; use it as the liveness probe. |
| `GET /health/ready` | `200` when the database answers, all migrations are applied and the master key is loaded, otherwise `503` with the failing check. Use it as the readiness probe and for load balancers. |
| `GET /metrics` | Prometheus metrics, with the token below. |
| `GET /tls/ask?domain=<domain>` | API only: `200` for a portal domain an instance administrator allowed, `404` otherwise. For Caddy's on-demand TLS, see [reverse-proxy.md](reverse-proxy.md#own-domains-for-knowledge-base-portals). |

All four answer on every host name, also on own domains of knowledge base portals, without a database lookup for the host. The answers contain no content and no personal data.

## Metrics

`/metrics` needs the header `Authorization: Bearer <token>`. The token is `PAGEHALL_METRICS_TOKEN`; without it, Pagehall generates one into `metrics-token` in the secrets directory (`docker compose exec pagehall cat /var/lib/pagehall/secrets/metrics-token`). The setup script writes one into `.env`. A request without the right token gets `401`.

Scrape the API: it exposes the values of the whole instance. The worker and the collaboration server expose the metrics of their own process (HTTP, database pool, job durations, open editors). Every series has the label `service` (`api`, `worker` or `collab`).

No metric has a label with personal data, a page title, a space name or another unbounded value. Labels are fixed names: routes as templates, job queue names, states and the fixed text of log events.

### Values of the instance (API)

| Metric | Type | Meaning |
|---|---|---|
| `pagehall_build_info{version}` | gauge | Always 1; `version` is the running version. All processes. |
| `pagehall_jobs{queue,state}` | gauge | Jobs per queue in the states `queued`, `active`, `deferred` (scheduled for later) and `failed` (failed after all attempts and still kept). |
| `pagehall_collab_up` | gauge | 1 when the collaboration server answers its readiness check, 0 otherwise. |
| `pagehall_mail_delivery_failures_total` | counter | Failed attempts to deliver an e-mail. Each mail is tried up to 9 times. |
| `pagehall_mail_undelivered_total` | counter | E-mails given up after the last attempt. |
| `pagehall_mail_last_success_timestamp_seconds` | gauge | Time of the last delivered e-mail, as a Unix timestamp. |
| `pagehall_mail_last_failure_timestamp_seconds` | gauge | Time of the last failed attempt. Missing until one fails. |
| `pagehall_storage_used_bytes` | gauge | Bytes used in the file store: on the volume for local storage, the running total of stored files for S3. |
| `pagehall_storage_size_bytes` | gauge | Size of the volume, or the configured limit for S3. |
| `pagehall_storage_usage_ratio` | gauge | Used share from 0 to 1. Missing for S3 without a limit. |
| `pagehall_storage_level` | gauge | Active storage warning level: 0 none, 1 warning, 2 large writes paused, 3 critical. See [storage.md](storage.md). |
| `pagehall_database_size_bytes` | gauge | Size of the Pagehall database. |
| `pagehall_backup_last_success_timestamp_seconds` | gauge | Time of the last successful backup. |
| `pagehall_backup_failures_total` | counter | Backups that failed. |
| `pagehall_backup_scheduled` | gauge | 1 when scheduled backups are on and have a target. |
| `pagehall_search_pending_items` | gauge | Items waiting to be indexed for search. |
| `pagehall_search_failing_items` | gauge | Items whose indexing failed at least once and is retried. |
| `pagehall_maintenance_mode` | gauge | 1 while maintenance mode is on. |
| `pagehall_update_available` | gauge | 1 when a newer release is available. Only exposed while the update check is on. |

Values that are not known are left out instead of reported as 0, for example the storage usage of S3 without a limit. The values are read from the database at most every 10 seconds.

### Values of each process

| Metric | Type | Meaning |
|---|---|---|
| `pagehall_http_requests_total{method,route,status}` | counter | HTTP requests by route template. |
| `pagehall_http_request_duration_seconds{method,route,status}` | histogram | Request latency. |
| `pagehall_job_duration_seconds{queue,state}` | histogram | Duration of job attempts on this worker, by outcome. |
| `pagehall_db_pool_connections{state}` | gauge | Database connections of this process: `total`, `idle`, `waiting`. |
| `pagehall_log_errors_total{type}` | counter | Error-level log events by their fixed text, the same as under [Recent errors](#recent-errors). |
| `pagehall_collab_connections` | gauge | Open editor connections (collaboration server). |
| `pagehall_collab_documents` | gauge | Documents the collaboration server holds open. |

The default metrics of Node.js (`process_*`, `nodejs_*`) come with every process.

### Prometheus

```yaml
scrape_configs:
  - job_name: pagehall
    scheme: http
    metrics_path: /metrics
    authorization:
      type: Bearer
      credentials_file: /etc/prometheus/pagehall-metrics-token
    static_configs:
      - targets: ["pagehall:3000"]
```

Scrape the address inside the network, not through the public address of the reverse proxy; or block `/metrics` on the proxy for everyone else.

Suggested alerts:

```yaml
groups:
  - name: pagehall
    rules:
      - alert: PagehallNotReady
        expr: up{job="pagehall"} == 0 or pagehall_collab_up == 0
        for: 5m
      - alert: PagehallNoRecentBackup
        expr: time() - pagehall_backup_last_success_timestamp_seconds > 26 * 3600
      - alert: PagehallBackupFailed
        expr: increase(pagehall_backup_failures_total[1d]) > 0
      - alert: PagehallStorageFilling
        expr: pagehall_storage_level >= 1
        for: 10m
      - alert: PagehallFailedJobs
        expr: sum by (queue) (pagehall_jobs{state="failed"}) > 0
        for: 30m
      - alert: PagehallJobBacklog
        expr: sum(pagehall_jobs{state="queued"}) > 1000
        for: 15m
      - alert: PagehallMailFailing
        expr: increase(pagehall_mail_undelivered_total[1h]) > 0
      - alert: PagehallMaintenanceForgotten
        expr: pagehall_maintenance_mode == 1
        for: 4h
      - alert: PagehallErrors
        expr: sum(increase(pagehall_log_errors_total[15m])) > 20
      - alert: PagehallUpdateAvailable
        expr: pagehall_update_available == 1
        for: 7d
```

The thresholds are starting points. Backups run once a day, so 26 hours leaves room for a slow run. Failed jobs are kept for a while, so the alert fires again until the cause is fixed and the jobs are retried or removed.

### Zabbix

Zabbix reads the metrics with an HTTP agent item and splits them with Prometheus preprocessing; no template is needed.

1. Create a host for the instance and a macro `{$PAGEHALL.METRICS.TOKEN}` of the type secret text with the token.
2. Add a master item of the type **HTTP agent**: URL `http://pagehall:3000/metrics`, request type GET, header `Authorization` with the value `Bearer {$PAGEHALL.METRICS.TOKEN}`, type of information **Text**, update interval `1m`, history `0` (keep only the dependent items).
3. Add a **dependent item** per value with the preprocessing step **Prometheus pattern**, for example:

| Item | Pattern | Type |
|---|---|---|
| Storage used | `pagehall_storage_usage_ratio` | Numeric (float); add a custom multiplier 100 for percent |
| Storage level | `pagehall_storage_level` | Numeric (unsigned) |
| Last backup | `pagehall_backup_last_success_timestamp_seconds` | Numeric (unsigned), unit `unixtime` |
| Failed mails | `pagehall_mail_undelivered_total` | Numeric (unsigned), then **Change per second** or **Simple change** |
| Maintenance mode | `pagehall_maintenance_mode` | Numeric (unsigned) |
| Collaboration server | `pagehall_collab_up` | Numeric (unsigned) |
| Version | `pagehall_build_info` with the label `version` as output | Character |

4. For the job queues, add a discovery rule as a dependent item with the preprocessing **Prometheus to JSON** and the pattern `pagehall_jobs{state="failed"}`, the LLD macro `{#QUEUE}` from `$.labels.queue`, and an item prototype with the pattern `pagehall_jobs{queue="{#QUEUE}",state="failed"}`.
5. Triggers with the thresholds of the Prometheus alerts above, for example `now() - last(/pagehall/backup.last) > 26h` and `last(/pagehall/storage.level) >= 1`.

The host itself (CPU, memory, disk of the volumes) is monitored by the Zabbix agent as usual.

## System status page

**Instance settings → System status** shows the state of the instance to people with the instance role area *operations*: the instance owner and administrators, the security auditor read-only, and custom roles given that area. Switching maintenance mode and checking for updates need *operations* at the level manage. It refreshes every minute; **Check again** runs the checks at once. The same data is available as `GET /api/v1/instance/operations/status`.

Each check says `ok`, `warning` or `error` with a short reason, the values it measured, a link to the settings page where the cause is fixed and a link to this documentation:

| Check | Warns or fails when |
|---|---|
| Version | A newer release is available. Notes when the update check is off or failed. |
| Maintenance mode | Maintenance mode is on. |
| Database | It does not answer (error) or migrations are pending. Shows its version and size. |
| File storage | A storage warning level is active: levels 1 and 2 are warnings, level 3 is an error. Notes when S3 storage has no limit. |
| Background jobs <a id="jobs"></a> | Jobs failed after all attempts, or more than 1,000 are waiting. The job queue table lists every queue with jobs. The worker's log says why a job failed. |
| Collaboration server <a id="collaboration"></a> | The collaboration server does not answer its readiness check: nobody can edit. |
| Backups | No backup target, scheduled backups off, backups failing, or no successful backup for the number of days set in the backup settings. Notes when backups before updates are off. See [backup.md](backup.md). |
| Search index <a id="search-index"></a> | The index is being rebuilt, or items failed to be indexed and are retried. |
| Recent errors | Error-level events were logged in the last 24 hours. |
| HTTPS | The instance address is not set or does not use HTTPS. |
| E-mail | E-mail is not set up, or the last delivery failed. |
| Encryption | The master key is not loaded (error), or the master keys live only in the secrets volume and their backup was not confirmed during setup. |
| Clock | The clocks of Pagehall and the database differ by more than 5 seconds. |
| File directory | The file directory is missing, not writable or has less than 1 GiB free (local storage only). |

### Recent errors

The list shows the error-level log events of the last 24 hours by type: the fixed text of the event (for example `Request failed`), the error code or class if the event had one, the processes that logged it, how often and when last. Texts that could contain data, such as names, addresses or paths, are counted as `Other error`. The full events are in the container logs (`docker compose logs pagehall`); search them for the text. Counts are kept for 7 days.

## Maintenance mode

Maintenance mode makes the instance read-only while you work on it, for example during a data migration or before an update that needs manual steps. Switch it on under **Instance settings → Maintenance mode**, with `PUT /api/v1/instance/maintenance`, or from a script:

```sh
./pagehall maintenance on --message "Update until 18:00" --block-sign-in
./pagehall maintenance status
./pagehall maintenance off
```

`./pagehall` is the command the setup script installs; with your own Compose file, run `docker compose exec pagehall pagehall maintenance on`.

While it is on:

- A banner with the message shows on every page of the app, on the sign-in page and in knowledge base portals.
- Every change through the API is refused with status `503`, the problem `maintenanceMode`, the administrators' message in `maintenanceMessage` and `Retry-After: 60`. This holds for everyone, also instance administrators. Reading, search and exports of single pages keep working. Signing in, the second factor, signing out, re-authentication, SCIM and switching maintenance mode itself still work; every other change is refused, also on routes added in later versions.
- The collaboration server opens documents read-only, and open editors switch to read-only with a notice. When maintenance ends, they become editable again without reloading.
- Background jobs that change content wait in their queues: imports, copies, versions of live pages, scheduled blog publication, trash retention, template file adoption, image versions, removal of orphaned files, rendering of portal articles, key rotation and the pruning of removed articles. A job that was already running finishes. Backups, mail and notification delivery, search indexing, storage checks, retention sweeps, identity provider synchronization, SCIM and the expiry of guest memberships and tokens keep running, so access is still removed when someone leaves.
- With **Pause signing in** (`--block-sign-in`), only instance administrators can sign in. People who are signed in stay signed in and can read.

Switching on, changing the message and switching off are recorded in the audit log (`maintenance.started`, `maintenance.changed`, `maintenance.ended`), shown on the system status page and in the metric `pagehall_maintenance_mode`.

## Updates

Pagehall is updated by starting a newer image; it applies migrations at start. [setup.md](setup.md#updates) describes the update command, the manual update and the rollback.

### Update check

The update check tells instance administrators about new versions. Once a day the worker downloads the public version file, by default `https://github.com/pagehall/pagehall/releases/latest/download/pagehall-versions.json`. The request carries no data about the instance: no address, no version, no identifier, only the HTTP request itself with the user agent `Pagehall update check`. It is on by default.

- Turn it off under **Instance settings → Updates**, or completely with `PAGEHALL_UPDATE_CHECK=false`: then Pagehall makes no request for it at all, and the setting cannot turn it on.
- `PAGEHALL_UPDATE_CHECK_URL` points it to a mirror. A mirror in a private network must be listed in `PAGEHALL_OUTBOUND_ALLOWED_NETWORKS`; public addresses must use HTTPS.
- When a new version is found, instance administrators get a notification once per version.
- **Instance settings → Updates** shows the running version, what is new in it, the releases after it with their changes, breaking changes and manual steps, and the commands to update, built for the installation method in `PAGEHALL_INSTALL_METHOD`. The commands come from Pagehall, never from the version file, and text from the file is shown as plain text only.
- A failed check is shown there with its reason and logged as one warning; the next check runs a day later, or at once with **Check now**.

**What's new** shows the changelog section of the running version from the changelog in the image. It works with the update check off and without network access.

### Changelog

`CHANGELOG.md` in the repository is the source of the release notes. Each release is a section:

```markdown
## 1.5.0 · 2026-11-02

Update from 1.3.0 or later.

### New

- Maintenance mode for scripted maintenance.

### Improved
### Fixed
### Breaking changes
### Manual steps
```

The groups are optional and only these five are allowed. `Update from … or later.` is optional and names the oldest version that can update to this release directly; the update command refuses to skip it. Unreleased changes collect under `## Unreleased`. For every release, CI builds the image, reads the version file from it (`pagehall release-notes --json`) and attaches it and `install.sh` to the GitHub release.
