# System status

**Settings › Instance › Operations › System status** shows the state of the instance in one place. It is meant for the people who run Lunedo: the instance owner and administrators, the security auditor (read-only) and custom instance roles with the area *operations*. Switching maintenance mode and checking for updates need *operations* at the level manage (see [roles-and-permissions.md](../roles-and-permissions.md)).

The page refreshes every minute; **Check again** runs the checks at once. Scripts read the same data with `GET /api/v1/instance/operations/status` (see `/api/docs`).

## How to read the page

Each check shows `OK`, `Warning` or `Error`, a short reason, the values it measured and, where the cause is fixed in the interface, **Open settings**. **Documentation** links to the section of this page that belongs to the check. The summary at the top counts the errors and warnings.

Below the checks, **Job queues** lists every queue with waiting, running, scheduled or failed jobs, with the age of its oldest waiting job, and **Recent errors** lists the error events of the last 24 hours.

The checks for the database, the clock and the file directory are the same as in the setup assistant and are described in [system-check.md](../system-check.md): [Database](../system-check.md#database), [Clock](../system-check.md#clock) and [File storage](../system-check.md#file-storage) (shown as **File directory**, only with local file storage).

## Checks

### Version

Shows the running version and, while the update check is on, whether a newer release exists. Fix it under **Settings › Instance › Operations › Updates**; [updates.md](../updates.md) describes the update and the rollback.

| Reason | Level | Text on the page | What to do |
|---|---|---|---|
| `updateAvailable` | Warning | Lunedo {version} runs; {latest} is available. The update page shows the changes and the commands. | Read the changes, breaking changes and manual steps on the update page, then update as described in [updates.md](../updates.md). |
| `checkFailed` | OK | Lunedo {version}. The last update check failed; the update page says why. | Open the update page; it names the reason, for example an unreachable mirror. Fix it and use **Check now**. |
| `checkOff` | OK | Lunedo {version}. The update check is off. | Nothing, if you watch releases another way. Otherwise turn the check on under **Updates**. |

### Maintenance

Warns while maintenance mode is on, so it is not forgotten. Fix it under **Settings › Instance › Operations › Maintenance mode**; see [maintenance-mode.md](../maintenance-mode.md).

| Reason | Level | Text on the page | What to do |
|---|---|---|---|
| `on` | Warning | On since {startedAt}: the instance is read-only. Switch it off when the maintenance is done. | Switch maintenance mode off when the work is finished. |
| `onSignInPaused` | Warning | On since {startedAt}: the instance is read-only and only instance administrators can sign in. Switch it off when the maintenance is done. | The same; switching it off also lets everyone sign in again. |

### Storage

Shows how full the file store is (the check is labelled **File storage**) and which storage warning level is active. Levels 1 and 2 are warnings, level 3 is an error. Fix it under **Settings › Instance › Operations › Storage**; [storage.md](../storage.md) explains the levels.

| Reason | Level | Text on the page | What to do |
|---|---|---|---|
| `warning` | Warning | {percent} of the file store is used. Free space or enlarge the volume before writes are paused. | Enlarge the volume or the S3 limit, or remove files that are no longer needed. |
| `largeWritesPaused` | Warning | {percent} used: new exports and imports are refused. Free space or enlarge the volume. | Free space or enlarge the volume. |
| `critical` | Error | {percent} used: uploads are refused. Free space or enlarge the volume now. | Free space or enlarge the volume at once; people cannot upload files. |
| `noLimit` | OK | S3 storage reports no free space, so usage is measured only once you set a limit. | Set a limit for the S3 storage on the storage page if you want warnings. |

### Jobs

Counts the background jobs of all queues (the check is labelled **Background jobs**). The **Job queues** table shows each queue with jobs waiting, running, scheduled or failed.

| Reason | Level | Text on the page | What to do |
|---|---|---|---|
| `failedJobs` | Warning | {failed} jobs failed after all attempts. The queues below show where; the worker's container logs show why. | See below. |
| `backlog` | Warning | {queued} jobs are waiting. Check that the worker runs and is not overloaded. | Check that the worker process runs (in the single container, the container `lunedo`) and look at its CPU, memory and database connections. The warning starts at 1,000 waiting jobs. |
| `unreachable` | Error | The job queue could not be read. Check the database connection and the worker's logs. | Check the [Database](../system-check.md#database) check and the logs of the worker. |

Failed jobs cannot be retried or removed in the interface, through the API or on the command line. Each failed job stays in the count until the job queue deletes it after its retention period. To find the cause:

1. Note the queue name in the **Job queues** table, for example `imports.work`.
2. Search the worker's log for `Job attempt failed` and that queue name. In the single container: `docker compose logs lunedo | grep "Job attempt failed"`. Each line is a JSON object with the fields `job` (the queue), `jobId`, `retryCount` and `err` (the error).
3. Fix the cause the error names, for example an unreachable target or a full volume. New jobs of the queue then succeed; the failed ones are not run again.

### Collaboration

Checks that the collaboration server answers its readiness check (the check is labelled **Collaboration server**). Without it, nobody can edit.

| Reason | Level | Text on the page | What to do |
|---|---|---|---|
| `unavailable` | Error | The collaboration server does not answer, so nobody can edit. Check that it runs and LUNEDO_COLLAB_UPSTREAM. | Check that the collaboration server runs (in the single container it runs inside `lunedo`), that `LUNEDO_COLLAB_UPSTREAM` points to it when it runs in its own container, and that `GET /health/ready` on its port answers `200`. Its log says why it is not ready. |
| `notChecked` | OK | Not checked by this process. | Nothing. The process that ran the checks does not probe the collaboration server. |

### Backups

Shows whether backups are set up and running. Fix it under **Settings › Instance › Operations › Backups**; see [backups.md](../backups.md).

| Reason | Level | Text on the page | What to do |
|---|---|---|---|
| `noTarget` | Warning | No backup target is set up. Set one up so that backups can run. | Set up a target as described in [backups.md](../backups.md). |
| `restored` | Warning | This instance was restored from a backup. Backups are paused until you confirm the target. | Check the target on the backups page. If this instance is a copy, change the target; otherwise use **Confirm target and resume backups**. |
| `off` | Warning | Scheduled backups are off. Turn them on, or make sure your own backups cover the database and the files. | Turn scheduled backups on, or make sure your own backups cover the database, the files and the keys. |
| `failed` | Error | The last backup failed: {lastFailureReason}. Check the target and run a backup again. | Fix the reason shown, then use **Back up now**. |
| `noRecentBackup` | Warning | There has been no successful backup for longer than the backup settings allow. Check the schedule and the target. | Check the schedule and the target. The number of days is the setting **Warn after days without a backup**. |
| `beforeUpdateOff` | OK | Backups work, but backups before updates are off. | Turn backups before updates on, or take a backup yourself before every update. |

### Search index

Shows whether the search index is complete.

| Reason | Level | Text on the page | What to do |
|---|---|---|---|
| `building` | Warning | The index is being rebuilt: {done} of {total} items. Search results are incomplete until then. | Wait. The worker builds the index; search keeps answering meanwhile. |
| `failingItems` | Warning | {failingItems} items could not be indexed and are retried. The worker's logs show why. | Search the worker's log for `Indexing an item for search failed`; the line names the item and the error. The worker tries again with growing pauses of up to one hour. |

The command line shows the state and rebuilds the whole index, for example after restoring a database by hand:

```sh
docker compose exec lunedo lunedo search status
docker compose exec lunedo lunedo search rebuild
```

`search rebuild` queues every page, blog post and running topic for the worker and returns at once. Search keeps answering while the index is rebuilt and tells people that results may be incomplete.

### Recent errors

Counts the error-level log events of the last 24 hours.

| Reason | Level | Text on the page | What to do |
|---|---|---|---|
| `errorsLogged` | Warning | {count} errors of {types} types in the last 24 hours. See the list below. | Look at the list and search the logs for the event text. |

The list **Recent errors** groups the events by type: the fixed text of the event (for example `Request failed`), its error code if it had one, the processes that logged it, how often and when last. Texts that could contain data, such as names, addresses or paths, are counted as `Other error`. The list never contains content or personal data.

The full events are in the container logs (`docker compose logs lunedo`); search them for the text. The counts are kept for 7 days. The metric `lunedo_log_errors_total` counts the same events (see [monitoring.md](../monitoring.md)).

### HTTPS

Checks that the instance address is set and uses HTTPS. Fix it under **Settings › Instance › General**; see [instance-address.md](../instance-address.md) and [reverse-proxy.md](../reverse-proxy.md#tls-and-the-instance-address).

| Reason | Level | Text on the page | What to do |
|---|---|---|---|
| `instanceUrlNotSet` | Warning | No instance address is set. Set it so that links in e-mails work. | Set the instance address. |
| `instanceUrlNotHttps` | Warning | {url} does not use HTTPS. Put Lunedo behind a reverse proxy with TLS and change the address. | Set up a reverse proxy with TLS, then change the address to `https://`. |

### E-mail

Checks that e-mail is set up and that the last delivery worked. Fix it under **Settings › Instance › Services › Delivery**; see [email.md](../email.md).

| Reason | Level | Text on the page | What to do |
|---|---|---|---|
| `notConfigured` | Warning | E-mail is not set up, so invitations and notifications are not sent. | Set up a sending method. |
| `deliveryFailing` | Error | The last delivery failed ({lastFailureCode}). Check the mail settings and send a test mail. | Check the settings, then use **Send test mail**. The check turns OK with the next successful delivery. |

### Encryption

Checks that the master key is loaded and that the keys are backed up. See [encryption.md](../encryption.md).

| Reason | Level | Text on the page | What to do |
|---|---|---|---|
| `masterKeyMissing` | Error | The master key is not loaded. Check the key settings and restart. | Check the key settings described in [encryption.md](../encryption.md) and restart Lunedo. Without the key, `GET /health/ready` answers `503`. |
| `keysNotBackedUp` | Warning | The master keys are stored only in the secrets volume, and their backup was not confirmed. Copy the secrets directory to a safe place. | Copy the secrets directory to a safe place outside the server. The check runs only when the master keys come from the secrets directory, not from `LUNEDO_MASTER_KEYS`. It counts the keys as backed up once the key backup step of the setup assistant was confirmed, or when the instance was set up through configuration. |
| `rotationRunning` | OK | Master key version {currentVersion} is loaded; a key rotation is running. | Nothing; the worker re-wraps the data keys. |
