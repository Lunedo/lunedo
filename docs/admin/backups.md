# Backups

A backup contains the database, the file store and the configuration. It is encrypted with the backup key. It never contains the master keys or the backup keys: keep those separately (see [Backing up the keys](encryption.md#backing-up-the-keys)). **A backup cannot be restored without its backup key, and the encrypted values in it cannot be read without the master keys.**

This page explains scheduled backups in the interface. Restoring is described in [Restoring a backup](backups/restore.md), the commands and the file format in [Backup reference](backups/backup-reference.md).

## Setting up backups

Instance administrators set up backups once under **Settings › Instance › Operations › Backups**:

1. Under **Target**, choose where backups are written: a [directory](backups/directory.md) or [S3-compatible storage](backups/s3.md). Use **Test connection**, then **Save target**.
2. Under **Schedule**, turn on **Back up every day** and choose the time.
3. Check **Retention** and **Advanced options**.
4. Under **Backup key**, store the backup key and the master keys outside the server, then tick **The backup key is stored outside Lunedo**.
5. Use **Back up now** under **Status** and check that the backup appears under **Backups in the target**.

Backups can be turned on only once a target is set up. While the instance has content and backups are off or have no target, a banner on the settings pages says so ("Backups are off" or "Backups are not set up"); there is no e-mail for it.

Viewing the page (the settings without the secret key, the status, the list and the results of test restores) needs the instance permission to view operations, which security auditors have. Every change, backup, test restore and deletion needs the permission to manage operations (see [Roles and permissions](roles-and-permissions.md)). Backups are never offered for download through the web interface.

Changes of the settings and the target (never the secret key), confirmations of the backup key, created, failed and deleted backups and test restores are recorded in the [audit log](audit-log.md), with names starting with `backup.`.

## Target

One target per instance:

- **Directory**: a directory inside the container, by default `/var/lib/lunedo/backups`. Mount a network share there to keep backups on another machine. See [Backups to a directory](backups/directory.md).
- **S3-compatible storage**: Amazon S3, Google Cloud Storage, MinIO, Cloudflare R2 and other S3-compatible services. See [Backups to S3-compatible storage](backups/s3.md).

Until a target is set up, backups before updates go to `LUNEDO_BACKUP_DIR` (by default `/var/lib/lunedo/backups`).

## Schedule

| Setting | Default | Description |
|---|---|---|
| **Back up every day** | off | Runs once a day on the worker. |
| **Time** | 02:00 | In the time zone of the instance, which the page shows. |
| **Weekly backup** | **No weekly backups** | A day of the week. The backup of that day is kept as a weekly one. |
| **Monthly backup** | **No monthly backups** | A day of the month. The backup of that day is kept as a monthly one; in shorter months the last day is used. A day that is both a weekly and a monthly day counts as monthly. |

- A day whose backup was due while the worker was down gets one backup when the worker is back, not one per missed day.
- Only one backup runs at a time across all workers. A scheduled backup that would overlap a running backup is skipped and listed as skipped. **Back up now** while a backup runs is refused with the message "A backup or test restore is already running"; a running test restore does not block it. `backup create` on the command line waits for the running backup instead.
- **Back up now** starts a manual backup to the same target. Manual backups are kept until they are deleted.

### Free space before a backup

Before every backup (scheduled, manual, before an update and `backup create`), Lunedo checks the free space:

- In the work directory (`LUNEDO_WORK_DIR`, by default `/var/lib/lunedo/work`) for the database dump, which is staged there while the backup runs: the size of the database plus 20 %.
- For a directory target, in the target: the larger of the last backup and the database, plus 20 %.

When both are on the same disk, the needs are added. A backup that would take a disk above the critical level of the [storage warnings](storage.md#levels) (95 % by default) is refused before the database dump starts, with the space it needs and the space that is free. This applies to S3 targets as well, because their dump is staged on the local disk too.

## Retention

Every backup has exactly one class: daily, weekly, monthly, manual or before update. Retention keeps the newest backups of each class:

| Setting | Default | Range |
|---|---|---|
| **Daily backups** | 7 | 1–1000 |
| **Weekly backups** | 4 | 1–1000 |
| **Monthly backups** | 6 | 1–1000 |

Manual backups are kept until they are deleted. How many backups before updates are kept is set in the section **Before updates**, see [Backups before updates](#backups-before-updates). A backup kept as a monthly one never counts against the daily ones.

Retention of daily, weekly and monthly backups runs after each successful scheduled or manual backup. Retention of backups before updates runs after each successful backup before an update. It deletes only backups that the run records of this instance list as created by it, with the name of a Lunedo backup and a readable backup header; other files in the target are never touched. A copy of the instance, made by copying the database or a virtual machine, therefore never deletes backups that the original wrote after the copy, and two instances that share a target never thin out each other's backups.

## Content

Under **Advanced options**, **Content** chooses what a backup contains:

| Option | Content |
|---|---|
| **Everything** (default) | Database, file store and configuration. |
| **Without the file store** | Database and configuration. For installations that snapshot the file store volume themselves. |

A restore of a backup without the file store restores the database and leaves the file store as it is. Restore the file store from your snapshot of the same time, or attachments created or deleted in between are missing or left over.

With S3 file storage, a backup with everything contains the objects of the bucket, and a restore writes them back to the configured bucket.

The configuration in a backup consists of the configuration file and a list of the settings from the environment. Secret values from the environment are replaced by `[set]`, and the master keys and the backup keys are left out. The configuration file is copied as it is, without the key settings: other secrets in it, such as an SMTP password or the password in `LUNEDO_DATABASE_URL`, are in the backup, protected only by its encryption. See [Configuration in a backup](backups/backup-reference.md#configuration-in-a-backup).

## Backup key

Backups are encrypted with the backup key: `LUNEDO_BACKUP_KEY`, or `backup-keys` in the secrets directory, which Lunedo generates on the first start when the key is not configured. The setup script writes `LUNEDO_BACKUP_KEY` to the `.env` file of the installation.

The section **Backup key** warns that a backup cannot be restored without this key. After you have stored the backup key and the master keys outside the server, tick **The backup key is stored outside Lunedo**. The page then shows when and by whom it was confirmed. Confirming the emergency kit in the setup assistant also confirms the backup key ("Confirmed in the setup on …"). The confirmation is recorded in the audit log as `backup.keyConfirmed`.

The backup key is a key ring like the master keys. To change it, see [Changing the backup key](encryption.md#changing-the-backup-key).

## Test restore

A test restore checks that a backup can really be restored. Start it with **Test restore** in the actions of a backup in the list. **Test-restore the newest backup every month** under **Advanced options** (on by default) starts one automatically: after a successful scheduled backup, when the last automatic test restore is a month old or older, that backup is tested. It does not run while backups are paused after a restore.

A test restore:

1. Verifies the backup like `backup verify`.
2. Checks that the database user may create databases. Without the privilege it stops with the result **Verified only** and shows the SQL that grants it, for example `ALTER ROLE "lunedo" CREATEDB;`, with **Copy SQL**.
3. Checks that the work directory (`LUNEDO_WORK_DIR`) has free space for the files of the backup and for a copy of the database, each plus 20 %, below the critical level of the storage warnings. Without enough space it stops with the result **Verified only** and says how much space it needs; the monthly test restore then logs a warning instead of reporting a failure.
4. Restores the backup into a temporary database on the same database server, `lunedo_test_restore_<id>`, and a temporary directory `test-restore-<id>` in the work directory. The database server needs free space for one more copy of the database. When PostgreSQL runs out of space or cannot create the temporary database, the result is **Verified only** with the space the copy needed.
5. Checks that the schema version matches the backup, that the main tables contain data and that every file the database refers to is present.
6. Removes the temporary database and directory, also when a step fails.

Lunedo cannot measure the disk of the database server. With the Compose file of the setup script, PostgreSQL keeps its data on the same host disk, so step 3 covers it. With an external database server, make sure it has room for one more copy of the database.

The result is kept with the backup: when, by whom, how far it got and which checks passed (**Passed**, **Verified only** or **Failed**). Only one test restore runs at a time.

If the worker is killed during a test restore, the temporary database and directory stay behind. The worker removes them when it starts, and the check that runs every minute removes every leftover that does not belong to a running test restore. The system status shows when this happened. A requested test restore counts as interrupted only once its job has started; one whose job never starts is marked as failed after a day.

## Warnings

Warnings go to the instance administrators (notification center, e-mail and push, as their preferences say) and to the [operations contacts](storage.md#operations-contacts) (e-mail, and a Teams post when a Teams webhook is set):

| Warning | When | Repeated |
|---|---|---|
| A backup failed | The first failed backup, with the reason. | By the reminder while backups keep failing. One message when a backup succeeds again. |
| No recent backup | No successful backup for the number of days in **Warn after days without a backup** (default 2, range 1–365), counted from the last successful backup or from when backups were turned on. Checked every minute. | By the reminder. One message when a backup succeeds again. |
| A test restore failed | Every failed test restore. | No. |

The reminder is the setting **Reminder while a level is active** on the [storage page](storage.md#storage-page) (weekly by default). While scheduled backups are off, have no target or are paused after a restore, Lunedo does not check for missing backups and clears an active warning.

The status of the backups is also shown in the [system status](monitoring/system-status.md#backups). For monitoring, `GET /api/v1/instance/backups/status` returns the last success, the last failure, the next run, whether a backup is running, whether scheduled backups and backups before updates are on, whether the backups are paused after a restore and when leftovers of a test restore were last removed. The route is described at `/api/docs` of your instance.

## Backups before updates

When migrations are pending at a start, Lunedo first writes a backup with the class "before update". The section **Before updates** has the setting **Back up before migrations** (on by default) and the setting **Backups before updates**, how many of these backups are kept (3 by default, 1–1000). It shows when `LUNEDO_BACKUP_BEFORE_UPDATE=false` turned it off. See [Updates](updates.md).

## Deleting a backup

**Delete backup** in the actions of a backup removes it from the target. It asks you to type the name of the backup and cannot be undone.

## After a restore

A restored instance pauses scheduled backups, retention and the monthly test restore until an instance administrator confirms the target. See [After a restore](backups/restore.md#after-a-restore).
