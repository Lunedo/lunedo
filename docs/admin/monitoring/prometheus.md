# Monitoring with Prometheus

Checked against Prometheus documentation, October 2026.

Prometheus reads the metrics of Lunedo from `/metrics` of the API. [monitoring.md](../monitoring.md) lists every metric and explains the token.

## Scraping

1. Save the metrics token in a file that Prometheus can read, for example `/etc/prometheus/lunedo-metrics-token`. The token is `LUNEDO_METRICS_TOKEN` from `.env`, or the generated file `metrics-token` in the secrets directory.
2. Add a scrape job. Use the address inside the network, here the Compose service `lunedo` on the API port:

   ```yaml
   scrape_configs:
     - job_name: lunedo
       scheme: http
       metrics_path: /metrics
       authorization:
         type: Bearer
         credentials_file: /etc/prometheus/lunedo-metrics-token
       static_configs:
         - targets: ["lunedo:3000"]
   ```

3. Reload Prometheus and check that the target `lunedo` is up.

When Prometheus can only reach Lunedo through the reverse proxy, block `/metrics` on the proxy for everyone else.

To watch each process separately, add the worker (port 3002) and the collaboration server (port 3001) as further targets with the same token. They expose only the values of their own process.

## Alerts

Suggested rules:

```yaml
groups:
  - name: lunedo
    rules:
      - alert: LunedoNotReady
        expr: up{job="lunedo"} == 0 or lunedo_collab_up == 0
        for: 5m
      - alert: LunedoNoRecentBackup
        expr: time() - lunedo_backup_last_success_timestamp_seconds > 26 * 3600
      - alert: LunedoBackupFailed
        expr: increase(lunedo_backup_failures_total[1d]) > 0
      - alert: LunedoStorageFilling
        expr: lunedo_storage_level >= 1
        for: 10m
      - alert: LunedoFailedJobs
        expr: sum by (queue) (lunedo_jobs{state="failed"}) > 0
        for: 30m
      - alert: LunedoJobBacklog
        expr: sum(lunedo_jobs{state="queued"}) > 1000
        for: 15m
      - alert: LunedoMailFailing
        expr: increase(lunedo_mail_undelivered_total[1h]) > 0
      - alert: LunedoMaintenanceForgotten
        expr: lunedo_maintenance_mode == 1
        for: 4h
      - alert: LunedoErrors
        expr: sum(increase(lunedo_log_errors_total[15m])) > 20
      - alert: LunedoUpdateAvailable
        expr: lunedo_update_available == 1
        for: 7d
```

The thresholds are starting points:

- Scheduled backups run once a day, so 26 hours leaves room for a slow run.
- Failed jobs cannot be retried or removed; they stay in `lunedo_jobs{state="failed"}` until the job queue deletes them after its retention period. `LunedoFailedJobs` therefore keeps firing for a while after the cause is fixed. [system-status.md](system-status.md#jobs) says how to find the cause in the logs.
- 1,000 waiting jobs is also the threshold of the [Jobs](system-status.md#jobs) check on the status page.
