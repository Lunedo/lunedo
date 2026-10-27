# Backups

A backup contains the database, the file store and the configuration. It never contains the master keys or the backup keys: keep those separately, for example by backing up the secrets directory to another place. **A backup cannot be restored without its backup key, and encrypted values in it cannot be read without the master keys.**

## Commands

The commands run inside the image, with the same configuration as the instance:

```sh
docker compose exec lunedo lunedo backup create --output /var/lib/lunedo/backups/lunedo.ldbak
docker compose exec lunedo lunedo backup create --before-update
docker compose run --rm lunedo backup skip-before-update
docker compose exec lunedo lunedo backup verify --input /var/lib/lunedo/backups/lunedo.ldbak
docker compose run --rm lunedo backup restore --input /var/lib/lunedo/backups/lunedo.ldbak
```

- `create` writes the backup. The output directory must be writable by the container user; `/var/lib/lunedo/backups` is.
- `create --before-update` writes a backup with the class "before update" to the configured target instead of a file; see [Backups before updates](#backups-before-updates). `skip-before-update` lets the next start apply pending migrations without that backup.
- `verify` checks the header, decrypts the whole backup and checks the manifest and every checksum without restoring anything.
- `restore` restores into an empty instance: an empty database and an empty file store. It verifies the backup first. It refuses to overwrite existing data unless `--force` is given, which replaces all database schemas and the content of the file store. See [How a restore changes the instance](#how-a-restore-changes-the-instance). `--config-dir <dir>` writes the configuration files from the backup to a directory for review; they are never applied automatically.

Stop the application before restoring. After the restore, start Lunedo; it applies migrations if the backup is from an older version. A new, empty instance can also restore a backup in the browser, from the first page of the setup; see [setup.md](setup.md#restore-during-the-setup).

Exit codes: 0 success, 1 failure, 64 invalid command, 78 invalid configuration.

## Scheduled backups

Instance administrators set up backups once under **Settings > Instance > Backups**. The section shows the target, the schedule, the retention, backups before updates, the backup key warning, the latest runs and the backups in the target. Viewing the section (settings without the secret key, the status, the list and the test restore results) needs the instance permission to view operations, which security auditors have; every change, backup, test restore and deletion needs the permission to manage operations. Backups are never offered for download through the web interface. Changes of the settings and the target (never the secret key), confirmations of the backup key, manual and failed backups, created and deleted backups and test restores are audited as `backup.*` events.

### Targets

One target per instance:

- **Directory:** an absolute path inside the container, by default `/var/lib/lunedo/backups` (`LUNEDO_BACKUP_DIR`). It must be writable by the container user, must not lie inside the file store, the secrets directory, the import folder or the work directory (`LUNEDO_WORK_DIR`), and must not contain the work directory. When the directory is on the same volume as the file store, the section warns that one disk failure loses both.
- **S3-compatible storage:** endpoint, region, bucket, optional prefix ending with `/`, access key, secret key and whether the bucket is addressed in the path. The secret key is stored encrypted with the master key and never shown again; leave it empty to keep it, or enter a new one to replace it. Changing the endpoint, the region, the bucket or the access key requires the secret key again, so a stored key is never sent to another service. Backups are streamed in parts of 8 MB and never held in memory; an upload that fails is aborted. Before each run, Lunedo aborts the unfinished uploads of earlier runs that its own run records list; uploads of any other instance writing to the same bucket are never touched.

**Test connection** writes, reads, lists and deletes a small test object with the entered settings, without saving them, and names the step and the cause of a failure: missing directory, permission, read-only file system, full target, DNS, a refused private address, connection, TLS, credentials or bucket.

The S3 client follows the same outbound rules as chat channels: private, loopback and link-local addresses are refused unless they are listed in `LUNEDO_OUTBOUND_ALLOWED_NETWORKS`, and public endpoints need HTTPS.

When a private endpoint is refused, **Test connection** names the address the endpoint resolved to and the network to add, for example `172.18.0.7/32`.

#### A storage service on the same Docker network

A storage service in the same Compose project, such as SeaweedFS, Garage or MinIO, has an address in a private network, which Lunedo refuses until it is allowed. Allow **only the address of the storage service**, never a whole subnet: `LUNEDO_OUTBOUND_ALLOWED_NETWORKS` also applies to chat channels, which space administrators set up, and to Confluence Cloud imports. A subnet that contains PostgreSQL or other containers of the installation would let them probe those services through a chat channel test. Put the storage service on a network of its own with a fixed address, keep Lunedo on the default network as well (PostgreSQL is there), and give the storage service credentials, so that other containers cannot write to it without a key:

<!-- backup-network-check -->
```yaml
services:
  lunedo:
    environment:
      LUNEDO_OUTBOUND_ALLOWED_NETWORKS: 172.30.1.10/32
    networks: [default, storage]
  storage:
    image: chrislusf/seaweedfs:4.48
    restart: unless-stopped
    environment:
      AWS_ACCESS_KEY_ID: ${STORAGE_ACCESS_KEY:?Set STORAGE_ACCESS_KEY in .env}
      AWS_SECRET_ACCESS_KEY: ${STORAGE_SECRET_KEY:?Set STORAGE_SECRET_KEY in .env}
    volumes:
      - storage:/data
    networks:
      storage:
        ipv4_address: 172.30.1.10

networks:
  storage:
    ipam:
      config:
        - subnet: 172.30.1.0/28

volumes:
  storage:
```

Add `STORAGE_ACCESS_KEY` and a long random `STORAGE_SECRET_KEY` to `.env` (for example `head -c 32 /dev/urandom | base64`), and enter the same two values as access key and secret key of the target. Choose a subnet that no other network on the host uses; `172.30.1.0/28` does not overlap the default network of the setup script (`172.30.0.0/24`). `scripts/backup-network-check.sh` starts this example together with the Compose file of the setup script and checks that the allowed address is only the storage service and that the storage service refuses requests without a key.

Use `http://172.30.1.10:8333` as endpoint, with path-style addressing on. The host name `storage` works as well, because Lunedo checks the address a name resolves to. Addresses in allowed networks may use `http://`. Keep the backups on another disk or host than the file store; a storage service on the same disk does not protect against losing it.

| Service | Endpoint | Region | Path-style | Keys |
|---|---|---|---|---|
| Amazon S3 | empty | the bucket's region, for example `eu-central-1` | off | an IAM access key with `s3:PutObject`, `s3:GetObject`, `s3:ListBucket`, `s3:DeleteObject`, `s3:AbortMultipartUpload` and `s3:ListBucketMultipartUploads` |
| Google Cloud Storage | `https://storage.googleapis.com` | `auto` or the bucket's location | off | an HMAC key of a service account (Cloud Storage > Settings > Interoperability) with the Storage Object Admin role on the bucket |
| MinIO | the MinIO address, for example `https://minio.example.org` | `us-east-1` unless MinIO is set to another one | on | a MinIO access key with read and write access to the bucket |
| Cloudflare R2 | `https://<account id>.r2.cloudflarestorage.com` | `auto` | off | an R2 API token with Object Read & Write for the bucket |

#### A network share as target

Mount the share into the container and use the mount point as directory target. With Docker Compose and NFS:

```yaml
services:
  lunedo:
    volumes:
      - lunedo-data:/var/lib/lunedo
      - backups:/mnt/backups

volumes:
  lunedo-data:
  backups:
    driver: local
    driver_opts:
      type: nfs
      o: addr=nas.example.org,rw,nfsvers=4
      device: ":/export/lunedo-backups"
```

For SMB, use `type: cifs`, `device: "//nas.example.org/lunedo-backups"` and `o: "username=lunedo,password=${SMB_PASSWORD:?Set SMB_PASSWORD in .env},uid=1000,gid=1000,file_mode=0600,dir_mode=0700"`, and put `SMB_PASSWORD` into `.env` (mode 600) instead of writing the password into `compose.yml`. The container runs as user 1000 (`node`). Then set the directory target to `/mnt/backups`.

### Schedule

- **Back up every day** at a time in the time zone of the instance, which the section shows. The run happens on the worker. A day whose backup is due while the worker was down gets one backup when it is back, not one per missed day.
- **Weekly backup** on a day of the week and **monthly backup** on a day of the month (in shorter months on the last day): the backup of that day is kept as a weekly or monthly one. A day that is both counts as monthly.
- Only one backup runs at a time across all workers. A scheduled run that would overlap a running backup is skipped and listed as skipped.
- **Back up now** starts a manual backup to the same target. Manual backups are kept until they are deleted.
- Before every backup (scheduled, manual, before an update and `backup create`), Lunedo checks the free space of the work directory for the database dump and, for a directory target, of the target for the backup: the size of the database plus 20 %, and for the target the larger of the last backup and the database, plus 20 %. When both are on the same disk, the needs are added. A backup that would take a disk above the critical level of the storage warnings (95 % by default, see [storage.md](storage.md)) is refused with the space it needs and the space that is free, before `pg_dump` starts. This applies to S3 targets as well, whose dump is staged on the local disk.

### Where the database dump is staged

`tar` needs the size of an entry before it is written, so the database dump is staged on disk while a backup runs. It is staged in `backup-staging` below the work directory (`LUNEDO_WORK_DIR`, by default `/var/lib/lunedo/work`, mode 0700, owned by the container user), never in the backup directory or a target, and it is encrypted under a key that exists only in memory for that run. A process that is killed in the middle of a backup leaves only ciphertext that nobody can read; Lunedo removes such leftovers when it starts and before every backup. In the Compose file of the setup script, the work directory is part of the data volume, not of the `backups` folder on the host.

Backups are named `lunedo-backup-<UTC time>-<class>-<random>.ldbak`, for example `lunedo-backup-20261021T020000Z-daily-3f0c8a1b.ldbak`.

### Retention

Grandfather-father-son: the newest 7 daily, 4 weekly and 6 monthly backups are kept (each number can be changed), the newest 3 backups before updates, and every manual backup until it is deleted. Every backup has exactly one class, so a backup kept as a monthly one never counts against the daily ones. Retention runs after each successful scheduled backup and deletes only backups that the run records of this instance list as created by it, with the name of a Lunedo backup and a readable backup header; other files in the target are never touched. A copy of the instance, made by copying the database or a virtual machine, therefore never deletes backups that the original wrote after the copy, and two instances that share a target never thin out each other's backups.

### After a restore

A restored database brings back the backup settings, the target and its secret key. If the restore created a second instance, for example a test system, it would write into and prune the backups of the original. So after `backup restore`, Lunedo pauses scheduled backups, retention and the monthly test restore. The backup settings and every page of the admin area show:

> This instance was restored from a backup. Backups are paused until you confirm the target.

An instance administrator then either confirms the target, which resumes the backups and is audited as `backup.targetConfirmed`, or changes the target, which resumes them as well. **Back up now** keeps working while the backups are paused, and a backup before an update goes to `LUNEDO_BACKUP_DIR` instead of the target and deletes nothing. The status page shows the pause. `backup restore` records this as the file `restored` in the work directory (`LUNEDO_WORK_DIR`), never in the file store, so no later backup carries it along; the next start turns it into the pause in the database and removes the file. Test restores never set it.

Deleting a backup in the list asks for its name and cannot be undone.

### Content

**Everything** (default) contains the database, the file store and the configuration. **Without the file store** is for installations that snapshot the file store volume themselves: the header says `"scope": "database"`, and a restore of such a backup restores the database and leaves the file store as it is. Restore the file store from a snapshot of the same time, or attachments created or deleted in between are missing or left over.

## Backups before updates

When a process starts and migrations are pending, Lunedo first writes a backup with the class "before update" to the target and waits for it, logging its progress every 30 seconds. While no target is set up, or while a restored instance waits for its target to be confirmed, it goes to `LUNEDO_BACKUP_DIR`, and the log says so. Backups before updates and the deletions of their retention are audited like other backups (`backup.created`, `backup.failed`, `backup.deleted`, with the class "before update"). Only the first process applies migrations; the others wait. The backup carries the schema version of the database before the update, so the previous version can restore it.

If the backup fails, the migrations are not run and the process stops with the reason and the command to start once without it:

```sh
docker compose run --rm lunedo backup skip-before-update
```

The request is written to the work directory and applies only to the next start of the version it was made for: the version of the image the command runs in, or the one given with `--for-version 1.4.2`. Every start removes it, whether migrations are pending or not, and a request for another version is ignored and logged. A request that a patch release without migrations did not need therefore never skips the backup of a later update.

The setting **Back up before migrations** and the environment variable `LUNEDO_BACKUP_BEFORE_UPDATE=false` turn the backup off for installations with their own backup strategy; the backup section shows which of them did. A fresh installation without migrations applied takes no backup.

Update scripts can take the backup themselves before pulling a new image:

```sh
docker compose exec lunedo lunedo backup create --before-update
```

It writes a "before update" backup to the target (or to `LUNEDO_BACKUP_DIR`), applies the retention of that class and prints only the location on standard output: a path, or `s3://<bucket>/<key>`. Messages go to standard error. Run `backup skip-before-update --for-version <new version>` afterwards if the first start of the new version should not take a second backup; `./lunedo update` does this.

Rolling back an update means restoring the backup before the update with the previous image.

## Test restore

**Test restore** in the list, or the monthly test restore (on by default: after a scheduled backup, once the last automatic test is a month old), checks one backup:

1. It verifies the backup like `backup verify`.
2. When the database user may create databases, it checks that the work directory (`LUNEDO_WORK_DIR`) has free space for the files of the backup and for a copy of the database (each plus 20 %), below the critical level of the storage warnings. Lunedo cannot measure the disk of the database server; with the Compose file of the setup script, PostgreSQL keeps its data on the same host disk, so the check covers it.
3. It restores the backup into a temporary database on the same server, `lunedo_test_restore_<id>`, and a temporary directory `test-restore-<id>` in the work directory, and checks that the schema version matches the backup, that the main tables contain data (the row counts are listed) and that every file the database refers to is present. The database server needs free space for one more copy of the database.
4. It removes the temporary database and directory, also when a step fails.

Without the privilege it stops after step 1 with the result "verified only" and shows the SQL that grants it, for example `ALTER ROLE "lunedo" CREATEDB;`. Without enough space it stops after step 2 with the result "verified only" and says how much space it needs; the monthly test restore then logs a warning instead of reporting a failure. The same happens when PostgreSQL itself runs out of space during the copy, or cannot create the temporary database: the test restore drops the temporary database and reports the space the copy needed. With an external database server, make sure it has room for one more copy of the database.

If the worker is killed during a test restore, the temporary database and directory stay behind. The worker removes them when it starts, and the check that runs every minute removes every leftover older than a running test restore. The status page shows when this happened. A requested test restore counts as interrupted only once its job has started; one whose job never starts is marked as failed after a day. The result is kept with the backup: when, by whom, how far it got and what it checked. Only one test restore runs at a time.

## Warnings

Warnings go to the instance administrators (notification center, e-mail and push by their preferences) and to the operations contacts set under Settings > Instance > Notifications (e-mail and Teams), with the same rules as the storage warnings:

| Warning | When | Repeated |
|---|---|---|
| A backup failed | the first failed run, with the reason | by the reminder of the operations contacts while backups keep failing; one message when a backup succeeds again |
| No recent backup | no successful backup for the configured number of days (default 2), checked every minute | by the reminder; one message when a backup succeeds again |
| A test restore failed | every failed test restore | no |

While the instance has content and backups are off or have no target, a banner on the settings pages says so; there is no mail for it.

For monitoring, `GET /api/v1/instance/backups/status` returns the last success, the last failure, the next run, whether scheduled backups are on, whether backups before updates are on, whether the backups are paused after a restore, and when leftovers of a test restore were last removed.

## Upgrading PostgreSQL to a new major version

1. Stop Lunedo and take a backup: `docker compose run --rm lunedo backup create --output /var/lib/lunedo/backups/before-postgres.ldbak`.
2. Start a new database container with the new major version and an empty data volume, for example `postgres:17-alpine` instead of `postgres:16-alpine`, and keep the old volume until the restore is checked.
3. Restore into it with the same secrets directory: `docker compose run --rm lunedo backup restore --input /var/lib/lunedo/backups/before-postgres.ldbak`.
4. Start Lunedo. CI restores a backup of the current major version into the next one on every run.

## Backup keys

Backup keys form a key ring like the master keys (`LUNEDO_BACKUP_KEY`, or `backup-keys` in the secrets directory, generated on first start). New backups use the highest version. To change the backup key, add a new version and keep the old ones for as long as backups made with them are kept.

## Checks before restoring

`verify` and `restore` read the header first and stop before reading any data when:

| Situation | Message |
|---|---|
| The file is not a backup | `<file> is not a Lunedo backup` |
| Unknown format version | `The backup uses format version <n>, which this Lunedo version cannot read. Restore it with the Lunedo version that created it or a newer one.` |
| Newer schema version | `The backup was created by Lunedo <version> with schema version <schema>, which is newer than this Lunedo version supports. Update Lunedo to version <version> or newer and run the command again.` |
| Backup key version missing | `The backup is encrypted with backup key version <n> (fingerprint <f>), which is not configured. Add this key version to LUNEDO_BACKUP_KEY or to the backup-keys file in the secrets directory and run the command again.` |
| Different key under that version | `The backup is encrypted with backup key version <n> (fingerprint <f>), but the configured key version <n> has fingerprint <g>. Configure the key the backup was created with.` |
| Master key version missing (restore only) | `The backup contains data encrypted with master key version <n> (fingerprint <f>), which is not available on this instance. Copy the master key ring of the instance the backup comes from (master-keys in its secrets directory, or LUNEDO_MASTER_KEYS) to this instance and run the restore again.` |
| Different master key under that version (restore only) | `The backup contains data encrypted with master key version <n> (fingerprint <f>), but master key version <n> of this instance has fingerprint <g>. Copy the master key ring of the instance the backup comes from (master-keys in its secrets directory, or LUNEDO_MASTER_KEYS) to this instance and run the restore again.` |

The header lists every master key version that encrypted data in the backup uses, so a restore stops before it writes anything when those keys are missing. A backup is only created when the master key ring of the instance contains all of them. `verify` does not need the master keys.

The fingerprint identifies a key without revealing it: the first 8 bytes of SHA-256 over `lunedo-backup-key` (or `lunedo-master-key` for master keys) and the key, in hex.

## Format

A backup file (`.ldbak`) starts with an unencrypted header, followed by an encrypted stream:

| Offset | Length | Content |
|---|---|---|
| 0 | 4 | Magic `LDBK` |
| 4 | 2 | Format version, 1, big endian |
| 6 | 4 | Length n of the header JSON, big endian |
| 10 | n | Header JSON, UTF-8 |
| 10 + n | rest | Encrypted stream (see [encryption.md](encryption.md)), key kind 2 (backup key) |

The header JSON:

```json
{
  "lunedoVersion": "1.0.0",
  "schemaVersion": "0000_foundation",
  "createdAt": "2026-10-01T06:00:00.000Z",
  "key": { "version": 1, "fingerprint": "3f0c8a1b2d4e6f70" },
  "masterKeys": [{ "version": 1, "fingerprint": "9a7e51c04b3d2f18" }],
  "cipher": "AES-256-GCM",
  "chunkSize": 65536
}
```

A backup without the file store adds `"scope": "database"`; a backup with everything leaves the field out, so older versions read it unchanged. Backups name the address of the instance that made them in `"instanceUrl"`, so that a restore during the setup can show where a backup comes from; backups of older versions lack the field.

The header is readable without the key, so a backup can be identified and checked before decryption. It is authenticated: the first 10 + n bytes are part of the authenticated data of every encrypted chunk, so any change to the header makes decryption fail.

The encrypted stream contains a gzip-compressed tar archive with these entries, in this order:

| Entry | Content |
|---|---|
| `database.dump` | `pg_dump` custom format of the whole database, without owners and privileges |
| `files/<path>` | Every regular file of the file store, by its path relative to `LUNEDO_FILES_DIR` |
| `config/environment.json` | The settings from the environment; secret values are replaced by `[set]`, key settings are left out |
| `config/lunedo.json` | The configuration file, if one is used, without key settings |
| `manifest.json` | Always the last entry |

The manifest repeats the versions and creation time of the header and lists every entry with its size and SHA-256 checksum:

```json
{
  "format": 1,
  "lunedoVersion": "1.0.0",
  "schemaVersion": "0000_foundation",
  "createdAt": "2026-10-01T06:00:00.000Z",
  "entries": [{ "path": "database.dump", "size": 1234, "sha256": "…" }]
}
```

Verification and restore reject a backup when:

- an entry is a symbolic link, a hard link, a device file, a named pipe or a directory,
- an entry path is absolute, contains `..` or empty segments, or lies outside `database.dump`, `files/` and `config/`,
- entries differ from the manifest, data follows the manifest, or the manifest does not match the header.

Because the whole backup is verified before anything is written, a rejected backup leaves the target untouched.

Deleting a backup, starting a test restore and **Back up now** answer with the problem `backupTargetFailed` (status 502) when the target cannot be used: `problem` names the cause (`notFound`, `permission`, `connection`, `credentials`, `missingSecret` and the other causes of **Test connection**), and the detail says what to do.

## How a restore changes the instance

A restore during the setup ends with a restart of every process, so that the restored data and keys are loaded. Lunedo ends itself and relies on a supervisor to start it again: Docker with `restart: unless-stopped` (as in the Compose file of the setup script) or a systemd unit with `Restart=always`. Without one, start Lunedo again by hand. `pnpm dev:apps` during development does not restart a process that ended; start it again yourself.

A restore runs in three phases, so that a failure leaves either the old instance or a clearly marked incomplete one, never a silent mix:

1. **Staging.** The files of the backup are extracted into `.lunedo-restore-staging` in the file store. This pass also verifies the whole backup. The existing files and the database are not touched; on failure the staging directory is removed.
2. **Database.** The marker file `.lunedo-restore-incomplete` is written to the file store. `pg_restore` turns the dump into SQL, which `psql` runs in a single transaction; with `--force`, the same transaction first drops all application schemas. Backups leave out large objects, which Lunedo does not use, so the script contains no transaction control of its own. The commit is sent only after the whole dump has been read without error. If anything fails before the commit, PostgreSQL rolls the transaction back, the staging directory and the marker are removed, and the instance is unchanged.
3. **Files.** After the commit, the existing files are removed and the staged files are moved into the file store, which is a rename on the same file system. Then the marker is removed.

If the restore stops between the commit and the removal of the marker, for example because the disk is full or the process is killed, the database already contains the backup while the file store may still hold the old files. The marker stays in that case, and the API, the collaboration server and the worker refuse to start:

```
The restore of the backup <file>, started at <time>, did not complete, so the database and the file store may not match. Run the restore again with: lunedo backup restore --input <file> --force. Lunedo does not start until a restore completes and removes <files>/.lunedo-restore-incomplete.
```

`backup create` refuses with the same message. Run the restore again with `--force`; a restore that completes removes the marker. The marker also stays when a process is killed during phase 2, although PostgreSQL has rolled the database back; the next step is the same. Backups never contain the marker or the staging directory, and a restore ignores both when it checks whether the file store is empty.

## Database connection

The backup tools use the same `LUNEDO_DATABASE_URL` as the application. They pass credentials through the environment, never on the command line, and they verify TLS at least as strictly as the application:

| URL parameters | Backup tools (`PGSSLMODE`) |
|---|---|
| no TLS parameters | not set; the libpq default `prefer` is not weaker than the application, which connects without TLS |
| `sslmode=disable`, also with certificate parameters | `disable` |
| `sslmode=prefer`, `require`, `verify-ca` or `verify-full`, `ssl=true`, or any of `sslrootcert`, `sslcert`, `sslkey` | `verify-full`, because the application verifies the certificate and host name for these |
| `sslmode=no-verify` | `require` |
| `uselibpqcompat=true&sslmode=prefer` | `require`, because the application requires TLS and never falls back to plaintext |
| `uselibpqcompat=true&sslmode=require` | `require`; `verify-ca` when `sslrootcert` is given |
| `uselibpqcompat=true&sslmode=verify-ca` | `verify-ca` |
| `uselibpqcompat=true` with `sslmode=verify-full`, `sslmode=no-verify`, no `sslmode` but `ssl=true` or certificate parameters | `verify-full` |

Certificate files are passed as `PGSSLROOTCERT`, `PGSSLCERT` and `PGSSLKEY`, and `application_name` as `PGAPPNAME`.

Other URL parameters stop the command with a message that names the parameter.

## PostgreSQL versions

`pg_dump` must be at least as new as the server, and dumps should be restored with the client that matches the target server. The image contains the clients for PostgreSQL 16, 17 and 18 and picks the one that matches the server's major version.

## Tests

CI creates a backup of an instance with sample data, verifies it, restores it into a fresh database and file store, compares both, and checks that a second restore is refused. It restores the same backup into the next PostgreSQL major version and compares again, and it lets a worker write a scheduled backup to S3-compatible storage (SeaweedFS), restores that backup into another fresh instance and compares its content and files (`scripts/backup-roundtrip.sh`).
