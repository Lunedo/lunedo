# Restoring a backup

A backup is restored with `lunedo backup restore` on the command line, or in the browser from the first page of the setup assistant of a new, empty instance. This page describes both, what Lunedo checks first, how a restore changes the instance and what to do afterwards. Creating backups is described in [Backups](../backups.md), every command and the file format in [Backup reference](backup-reference.md).

To restore a backup you need:

- the backup file (`.ldbak`);
- the backup key ring the backup was encrypted with;
- the master key ring of the instance the backup comes from;
- a Lunedo version at least as new as the one that created the backup.

Where these keys are kept is described in [Backing up the keys](../encryption.md#backing-up-the-keys).

## Commands

The commands run inside the image, with the same configuration as the instance. In an installation of the setup script, run them in the installation directory:

```sh
docker compose run --rm lunedo backup verify --input /var/lib/lunedo/backups/lunedo-backup-20261021T020000Z-daily-3f0c8a1b.ldbak
docker compose stop lunedo
docker compose run --rm lunedo backup restore --input /var/lib/lunedo/backups/lunedo-backup-20261021T020000Z-daily-3f0c8a1b.ldbak
docker compose up -d
```

- `verify` checks the header, decrypts the whole backup and checks the manifest and every checksum without restoring anything. It needs the backup key, not the master keys. It can run while Lunedo runs.
- `restore` restores into an empty instance: an empty database and an empty file store. It verifies the backup first. It refuses to overwrite existing data unless `--force` is given, which replaces all database schemas and the content of the file store.
- `--config-dir <dir>` writes the configuration files from the backup to a directory for review. They are never applied automatically.

Stop Lunedo before restoring. After the restore, start Lunedo; it applies the migrations when the backup comes from an older version.

`verify` and `restore` read local files only. The file must be readable by the container user (user 1000). In an installation of the setup script, the folder `backups` of the installation directory is `/var/lib/lunedo/backups` in the container.

## Fetching a backup from S3

When the backups are in a bucket, download the backup first with any S3 client, for example the AWS CLI, into the folder that the container sees as `/var/lib/lunedo/backups`:

```sh
aws s3 cp s3://lunedo-backups/lunedo/lunedo-backup-20261021T020000Z-daily-3f0c8a1b.ldbak /opt/lunedo/backups/
chown 1000:1000 /opt/lunedo/backups/lunedo-backup-20261021T020000Z-daily-3f0c8a1b.ldbak
```

For services other than Amazon S3, add `--endpoint-url` with the endpoint of the target. The list under **Backups in the target** on the backup page shows the names of the backups. The setup assistant of a new instance can download a backup from a bucket itself (see [Restore during the setup assistant](#restore-during-the-setup-assistant)).

## Checks before restoring

`verify` and `restore` read the header first and stop before reading any data when:

| Situation | Message |
|---|---|
| The file is not a backup | `<file> is not a Lunedo backup` |
| Unknown format version | `The backup uses format version <n>, which this Lunedo version cannot read. Restore it with the Lunedo version that created it or a newer one.` |
| Unknown cipher | `The backup is encrypted with <cipher>, which this Lunedo version does not support. Restore it with the Lunedo version that created it or a newer one.` |
| Newer schema version | `The backup was created by Lunedo <version> with schema version <schema>, which is newer than this Lunedo version supports. Update Lunedo to version <version> or newer and run the command again.` |
| Backup key version missing | `The backup is encrypted with backup key version <n> (fingerprint <f>), which is not configured. Add this key version to LUNEDO_BACKUP_KEY or to the backup-keys file in the secrets directory and run the command again.` |
| Different key under that version | `The backup is encrypted with backup key version <n> (fingerprint <f>), but the configured key version <n> has fingerprint <g>. Configure the key the backup was created with.` |
| Master key version missing (restore only) | `The backup contains data encrypted with master key version <n> (fingerprint <f>), which is not available on this instance. Copy the master key ring of the instance the backup comes from (master-keys in its secrets directory, or LUNEDO_MASTER_KEYS) to this instance and run the restore again.` |
| Different master key under that version (restore only) | `The backup contains data encrypted with master key version <n> (fingerprint <f>), but master key version <n> of this instance has fingerprint <g>. Copy the master key ring of the instance the backup comes from (master-keys in its secrets directory, or LUNEDO_MASTER_KEYS) to this instance and run the restore again.` |

The header lists every master key version that encrypted data in the backup uses, so a restore stops before it writes anything when those keys are missing. The fingerprint identifies a key without revealing it.

Because the whole backup is verified before anything is written, a rejected backup leaves the instance untouched. A restore into an instance that is not empty, without `--force`, stops with `Restore refused: the database is not empty. Use --force to overwrite it` (or `the file store`).

## Restore on a new server

This procedure moves an instance installed with the setup script to a new server, or rebuilds it after the old server is lost. For an installation with your own Compose file, the steps are the same; put the keys where your configuration expects them.

1. On the new server, install Lunedo with the setup script (see [Installation with the setup script](../installation/script.md)), with the same version as the old server or a newer one. Use the same file storage settings as the old server; with S3 file storage, the restore writes the attachments to the configured bucket and removes every other object under `<prefix>attachments/`. While the old server still runs, give the new one a bucket or prefix of its own.
2. Stop Lunedo in the installation directory, for example `/opt/lunedo`:

   ```sh
   cd /opt/lunedo
   docker compose stop lunedo
   ```

3. In `.env`, replace the values of `LUNEDO_MASTER_KEYS` and `LUNEDO_BACKUP_KEY` with the complete key rings of the old server: from its `.env`, or the lines `LUNEDO_MASTER_KEYS` and `LUNEDO_BACKUP_KEY` of the emergency kit. When the old server kept its keys in its secrets directory (`master-keys`, `backup-keys`), use their content, with the entries separated by commas.
4. Copy the backup into the folder `backups` of the installation directory and give it to user 1000 (see [Fetching a backup from S3](#fetching-a-backup-from-s3) when it is in a bucket).
5. Verify it:

   ```sh
   docker compose run --rm lunedo backup verify --input /var/lib/lunedo/backups/lunedo-backup-20261021T020000Z-daily-3f0c8a1b.ldbak
   ```

6. Restore it. The first start of the new installation has already created the database, so `--force` is needed:

   ```sh
   docker compose run --rm lunedo backup restore --input /var/lib/lunedo/backups/lunedo-backup-20261021T020000Z-daily-3f0c8a1b.ldbak --force
   ```

7. Start Lunedo with `docker compose up -d`. It applies pending migrations.
8. Sign in with an account from the backup. When the new server has another address, check the instance address (see [Instance address](../instance-address.md)); `LUNEDO_INSTANCE_URL` in `.env`, when set, always applies.
9. Under **Settings › Instance › Operations › Backups**, confirm the backup target or change it (see [After a restore](#after-a-restore)).
10. Store the `.env` file of the new server outside the server.

Instead of steps 4 to 7, a new installation can also restore the backup in the browser before it is set up (see [Restore during the setup assistant](#restore-during-the-setup-assistant)). Do step 3 first: keys configured in `.env` stay as they are, and the restore stops before it changes anything when they cannot read the backup.

## Restore during the setup assistant

Instead of setting up a new instance, the first page of the setup assistant, **Welcome**, can restore a backup into this empty instance, like `lunedo backup restore` on the command line, which this builds on. Every step needs the setup session that the setup code opens, and works only while the instance is not set up.

1. **Backup**, from one of three places:
   - **Upload a backup**: a `.ldbak` file from the browser, sent in parts of at most 8 MiB, so the body limit of a reverse proxy does not matter. A part that the proxy still refuses with `413` is split further, down to 256 KiB. An interrupted upload continues where it stopped, also after a reload when the same file is chosen again. The file may be as large as the free space of `LUNEDO_BACKUP_DIR`, where it is stored.
   - **From an S3 target**: endpoint, bucket, prefix, region and the access keys of the bucket the earlier server backed up to. **Connect and load backups** lists the backups with date, size, version and content. The server downloads the chosen one into `LUNEDO_BACKUP_DIR` itself, not through the browser. The keys are used for this restore only and are never stored; a restored database brings its own backup target. Endpoints in private networks need `LUNEDO_OUTBOUND_ALLOWED_NETWORKS`, as for [backup targets](s3.md#endpoints-in-private-networks).
   - **From the server**: the backups in `LUNEDO_BACKUP_DIR`, or in another directory given as an absolute path that Lunedo may read (**Use another directory**). Only files ending with `.ldbak` are listed.
2. **Keys**: when the backup names another address than the one the setup is opened with, or names none, the step says so ("The backup comes from https://old.example.com. This instance runs under https://wiki.example.com.") and offers **Use the new address** (chosen by default) or **Keep the old one**. With the new address, the restore sets the instance URL to it after the migrations, so that sign-in, passkeys and links in e-mails work without `LUNEDO_INSTANCE_URL`; the change is recorded in the audit log and ends the sessions of the backup. `LUNEDO_INSTANCE_URL`, when set, always wins. The progress page repeats the addresses and says which one applies.

   Then enter the **Backup key** of the earlier server (the line `LUNEDO_BACKUP_KEY` of the emergency kit from its setup, or the content of its `backup-keys`) and choose the **Master keys** as a file (the emergency kit from its setup, or `master-keys` from its secrets directory). The file is read in the browser and sent with the request; it is not stored as a file. Lunedo checks both against the header of the backup before it changes anything.
3. **Restore**: the steps *Backup verified*, *Database restored*, *File store restored* and *Migrations applied*, plus *Backup downloaded from the bucket* for a bucket, each with its state. The restore replaces the database and the file store of this instance, even though they already hold the setup state. Where Lunedo manages the keys in its secrets directory (`master-keys`, `backup-keys`), the keys of the backup replace them. Configured keys (`LUNEDO_MASTER_KEYS`, `LUNEDO_BACKUP_KEY`) stay, and the restore stops before it changes anything when the configured master keys cannot read the backup. Afterwards the backups are paused until the target is confirmed (see [After a restore](#after-a-restore)).

When the restore is complete, every process of the instance ends itself gracefully, so that the container restarts with the restored data and keys. The progress page waits for the restart and then offers **Go to sign-in** with an account from the backup. The progress is kept in `setup-restore.json` in `LUNEDO_WORK_DIR` for a day.

The restore runs in the API process that received it. With several API nodes, give them the same `LUNEDO_BACKUP_DIR` and `LUNEDO_WORK_DIR`, or restore on one node. A restore that a restart interrupts is reported as interrupted; when the database was already replaced, Lunedo refuses to start until a restore completes, as after an interrupted `backup restore`.

The log records the start, the end and failures of the restore. The keys, the access keys of a bucket and the content are never logged.

## After a restore

A restored database brings back the backup settings, the target and its secret key. If the restore created a second instance, for example a test system, it would write into and prune the backups of the original. So after a restore, Lunedo pauses scheduled backups, retention and the monthly test restore. The backup settings and every page of the admin area show:

> This instance was restored from a backup. Backups are paused until you confirm the target.

An instance administrator then either confirms the target with **Confirm target and resume backups**, which resumes the backups and is recorded in the audit log as `backup.targetConfirmed`, or changes the target, which resumes them as well. While the backups are paused:

- **Back up now** keeps working, without retention.
- A backup before an update goes to `LUNEDO_BACKUP_DIR` instead of the target and deletes nothing.
- The system status shows the pause (see [System status](../monitoring/system-status.md#backups)).

`backup restore` records the restore as the file `restored` in the work directory (`LUNEDO_WORK_DIR`), never in the file store, so no later backup carries it along. The next start turns it into the pause in the database and removes the file. Test restores never set it.

## How a restore changes the instance

Everything in the database returns to the state of the backup: content, accounts, roles, settings, sessions and the backup settings. Changes made after the backup are lost. With a backup that contains everything, the file store returns to the same state; with a backup without the file store, restore the file store from a snapshot of the same time.

People sign in with the accounts and credentials that were valid when the backup was made. When a restore during the setup takes over a new address, the sessions from the backup end, and passkeys registered under the old address do not work under the new one.

A restore during the setup ends with a restart of every process, so that the restored data and keys are loaded. Lunedo ends itself and relies on a supervisor to start it again: Docker with `restart: unless-stopped` (as in the Compose file of the setup script) or a systemd unit with `Restart=always`. Without one, start Lunedo again by hand.

A restore is built so that a failure leaves either the old instance or a clearly marked incomplete one, never a silent mix. The files of the backup are first unpacked next to the file store, the database is then replaced in a single transaction, and only then are the files moved into place. If anything fails before the database is replaced, the instance is unchanged. With S3 file storage, the files are unpacked on the local disk first and then written to the bucket, so the local disk needs room for them.

If the restore stops after the database was replaced and before the files are in place, for example because the disk is full or the process is killed, the database already contains the backup while the file store may still hold the old files. The API, the collaboration server and the worker then refuse to start, and `backup create` refuses as well:

```
The restore of the backup <file>, started at <time>, did not complete, so the database and the file store may not match. Run the restore again with: lunedo backup restore --input <file> --force. Lunedo does not start until a restore completes and removes <files>/.lunedo-restore-incomplete.
```

Run the restore again with `--force`; a restore that completes removes the marker. The marker also stays when a process is killed while the database is being replaced, although PostgreSQL has rolled the database back; the next step is the same.

## Upgrading PostgreSQL to a new major version

A new major version of PostgreSQL cannot use the data directory of the old one. Move the data with a backup:

1. Stop Lunedo and take a backup:

   ```sh
   docker compose stop lunedo
   docker compose run --rm lunedo backup create --output /var/lib/lunedo/backups/before-postgres.ldbak
   ```

2. Start a new database container with the new major version and an empty data volume, for example `postgres:18-alpine` instead of `postgres:17-alpine`, and keep the old volume until the restore is checked.
3. Restore into it with the same keys:

   ```sh
   docker compose run --rm lunedo backup restore --input /var/lib/lunedo/backups/before-postgres.ldbak
   ```

4. Start Lunedo with `docker compose up -d`.

The supported PostgreSQL versions are listed in [Backup reference](backup-reference.md#postgresql-versions).
