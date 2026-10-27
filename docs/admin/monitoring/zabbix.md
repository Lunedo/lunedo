# Monitoring with Zabbix

Zabbix reads the metrics of Lunedo with an HTTP agent item and splits them with Prometheus preprocessing; no template is needed. [monitoring.md](../monitoring.md) lists every metric and explains the token.

1. Create a host for the instance and a macro `{$LUNEDO.METRICS.TOKEN}` of the type secret text with the metrics token.
2. Add a master item of the type **HTTP agent**: URL `http://lunedo:3000/metrics`, request type GET, header `Authorization` with the value `Bearer {$LUNEDO.METRICS.TOKEN}`, type of information **Text**, update interval `1m`, history **Do not store** (only the dependent items keep values).
3. Add a **dependent item** per value with **Prometheus pattern** as its first preprocessing step and **value** as result processing, for example:

   | Item | Key (your choice) | Pattern | Type |
   |---|---|---|---|
   | Storage used | `storage.used` | `lunedo_storage_usage_ratio` | Numeric (float); add the preprocessing step **Custom multiplier** `100` for percent |
   | Storage level | `storage.level` | `lunedo_storage_level` | Numeric (unsigned) |
   | Last backup | `backup.last` | `lunedo_backup_last_success_timestamp_seconds` | Numeric (unsigned), unit `unixtime` |
   | Failed mails | `mail.undelivered` | `lunedo_mail_undelivered_total` | Numeric (unsigned), then the preprocessing step **Change per second** or **Simple change** |
   | Maintenance mode | `maintenance` | `lunedo_maintenance_mode` | Numeric (unsigned) |
   | Collaboration server | `collab.up` | `lunedo_collab_up` | Numeric (unsigned) |
   | Version | `version` | `lunedo_build_info`, result processing **label** with the label `version` | Character |

4. For the job queues, add a discovery rule as a dependent item with the preprocessing **Prometheus to JSON** and the pattern `lunedo_jobs{state="failed"}`, the LLD macro `{#QUEUE}` from `$.labels['queue']`, and an item prototype with the pattern `lunedo_jobs{queue="{#QUEUE}",state="failed"}`.
5. Add triggers with the thresholds of the [Prometheus alerts](prometheus.md#alerts), for example, for a host named `lunedo`, `now() - last(/lunedo/backup.last) > 26h` and `last(/lunedo/storage.level) >= 1`.

Use the address inside the network, not the public address of the reverse proxy. The host itself (CPU, memory, disk of the volumes) is monitored by the Zabbix agent as usual.
