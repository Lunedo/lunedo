# Backup internals

This page explains how backups, restores and test restores work inside the code. The operator view is in [Backups](../admin/backups.md), [Restoring a backup](../admin/backups/restore.md) and [Backup reference](../admin/backups/backup-reference.md), which also describes the file format.

## Modules

The backup code lives in `packages/server/src/backup/`:

| File | Content |
|---|---|
| `archive.ts` | Backup file format: header, encrypted tar archive, manifest, `createBackup`, `verifyBackup`, `restoreBackup`. |
| `postgres.ts` | `PostgresArchiver`: `pg_dump`, `pg_restore` and `psql` with the TLS mapping of `LUNEDO_DATABASE_URL`, and the choice of the client by the server's major version. |
| `runner.ts` | `writeBackup` and `writeBackupFile`, the free space checks, the staging directory, advisory locks, retention. |
| `targets.ts` | Directory and S3 targets: write, list, read, delete, test, cleanup of unfinished uploads, failure classification. |
| `service.ts` | `BackupService`: settings, target, schedule check, runs, test restores, warnings, the pause after a restore. |
| `test-restore.ts` | The test restore into a temporary database and directory, and the cleanup of leftovers. |
| `before-update.ts` | Backups before migrations and the skip request. |
| `restore-marker.ts`, `restored.ts` | The marker of an incomplete restore in the file store and the `restored` marker in the work directory. |
| `schedule.ts`, `retention.ts`, `naming.ts` | Slots in the instance time zone, retention by class, backup names. |

The configuration files in a backup come from `configurationForBackup` in `packages/server/src/config/backup-view.ts`. The command line is in `apps/worker/src/cli/`, the HTTP routes in `apps/api/src/backups/`, the restore during the setup in `packages/server/src/setup/restore.ts`.

## Writing a backup

`writeBackup` (scheduled, manual and before-update backups) and `writeBackupFile` (`backup create --output`):

1. Take the backup lock (`lunedo.backup`, a PostgreSQL advisory lock). A scheduled run or **Back up now** that cannot get it is recorded as `skipped`; `backup create` waits for it.
2. Take the rotation lock (`lunedo.key-rotation`) in shared mode, so that no master key version is added while the backup collects the versions in use. The header lists every version that columns and stored files use, plus the target of a running rotation; a backup is created only when the key ring contains all of them.
3. Check the free space (database plus 20 % in the work directory, and for a directory target the larger of the last backup and the database plus 20 %, added when both are on one device) against the critical level of the storage warnings.
4. Remove unfinished uploads or `.partial` files of earlier runs that the run records list, and staged dumps that a killed process left.
5. Stream the archive: the database dump, every file of the file store, the objects of an S3 file store as `files/attachments/<key>`, the configuration files and the manifest.

### Staging the database dump

`tar` needs the size of an entry before it is written, so the database dump is staged on disk. It is written to `backup-staging` below the work directory (`LUNEDO_WORK_DIR`, mode 0700, owned by the container user), never to the backup directory or a target. It is encrypted with the stream format under a key that exists only in memory for that run. A process that is killed in the middle of a backup leaves only ciphertext that nobody can read; Lunedo removes such leftovers when it starts and before every backup. The staging directory must not lie inside a directory target.

### Targets

A directory target writes `<name>.<uuid>.partial`, syncs it and renames it. An S3 target uploads in parts of 8 MiB with the AWS SDK `Upload` and aborts the upload on failure; before each run it aborts the unfinished multipart uploads whose keys are in its own run records. The S3 client resolves host names through the outbound policy, so private addresses are refused unless they are in `LUNEDO_OUTBOUND_ALLOWED_NETWORKS`. Failures are classified into the causes that **Test connection** and the `backupTargetFailed` problem report.

## Restoring

`restoreBackup` reads the backup twice and runs in three phases, so that a failure leaves either the old instance or a clearly marked incomplete one:

1. **Staging.** The files of the backup are extracted into `.lunedo-restore-staging` in the file store. This pass also verifies the whole backup. The existing files and the database are not touched; on failure the staging directory is removed.
2. **Database.** The marker file `.lunedo-restore-incomplete` is written to the file store. The header is read again and must be unchanged. `pg_restore` turns the dump into SQL, which `psql` runs in a single transaction (`begin` … `commit`, with `ON_ERROR_STOP`); with `--force`, the same transaction first drops all application schemas. Backups leave out large objects (`pg_dump -B`), which Lunedo does not use, so the script contains no transaction control of its own. The commit is sent only after the whole dump has been read without error. If anything fails before the commit, PostgreSQL rolls the transaction back, the staging directory and the marker are removed, and the instance is unchanged.
3. **Files.** After the commit, the second pass must have produced the same header and manifest. The existing files are removed and the staged files are moved into the file store, a rename on the same file system. With an S3 file store, the staged `attachments/` are uploaded to the bucket, and objects that are not in the backup are deleted. Then the marker is removed.

When the restore stops between the commit and the removal of the marker, `checkRestoreComplete` makes the API, the collaboration server, the worker and `backup create` refuse to start. Backups never contain the marker or the staging directory, and a restore ignores both when it checks whether the file store is empty.

`backup restore` and the restore during the setup write the file `restored` to the work directory. `pauseBackupsAfterRestore` turns it into `backup_state.restored_at` on the next start and removes the file. While `restored_at` is set, scheduled runs, retention and the automatic test restore are skipped; confirming or changing the target clears it.

The restore during the setup runs `restoreBackup` with `force`, installs the keys of the backup where the file provider manages them, runs the migrations, and then sends a notification on the channel `lunedo_restart`; every process that listens ends itself so that the supervisor restarts it with the restored data and keys.

## Test restores

A test restore verifies the backup, checks the `CREATEDB` privilege and the free space of the work directory, creates `lunedo_test_restore_<id>` and `test-restore-<id>` in the work directory, restores into them with `restoreBackup`, checks the schema version, the row counts of the main tables and that every file the database refers to is present, and drops both again. A separate advisory lock allows one test restore at a time. Leftovers are matched by name and, for databases, by the owner being the current database user; the worker removes them at start, and the minute check removes those that do not belong to the running test restore.

The automatic test restore is claimed with an update of `backup_state.last_automatic_test_at` that only succeeds when the last one is a month old, so two workers never start it twice.

## Tests

- Unit and integration tests next to the modules cover the format, the rejections, the TLS mapping, the targets, retention, the schedule, the pause after a restore and the test restore.
- `scripts/backup-roundtrip.sh <image>` runs in CI when files of the backup area change (`backupPaths` in `scripts/ci-scope.ts`). It sets up an instance with sample data through configuration, creates a backup, verifies it, restores it into a fresh database and file store, compares both, and checks that a second restore is refused. It restores the same backup from PostgreSQL 16 into PostgreSQL 17 and compares again. Then it lets a worker write a scheduled backup to S3-compatible storage (SeaweedFS), restores that backup into another fresh instance and compares its content and files.
- `scripts/backup-network-check.sh <image>` reads the Compose example marked `<!-- backup-network-check -->` from `docs/admin/backups/s3.md`, starts it together with the Compose file of the setup script, and checks that the allowed address is only the storage service and that the storage service refuses requests without a key. Keep the marker and the fenced block after it together.
