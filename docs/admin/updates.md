# Updates

An update starts a newer image of Lunedo. When it starts, Lunedo first takes a backup and then applies the migrations of the new version. Migrations only go forward, so going back means restoring the backup from before the update; see [Rollback](#rollback).

**Settings › Instance › Operations › Updates** shows the running version, what is new in it, the releases after it with their changes, and the commands to update this installation. The commands are built for the installation method in `LUNEDO_INSTALL_METHOD` and the directory in `LUNEDO_INSTALL_DIR`.

## Before you update

Read the breaking changes and manual steps of every release between the running version and the new one. They are listed under **Settings › Instance › Operations › Updates**, or printed by the new image:

```sh
docker run --rm ghcr.io/lunedo/lunedo:1.5.0 release-notes --update-from 1.4.2
```

A release can name the oldest version that may update to it directly ("Update to it from 1.3.0 or later"). From an older version, update to an intermediate release first. `release-notes --update-from` then fails with exit code 65.

## With the update command

After an installation with the [setup script](installation/script.md), update with the `lunedo` command in the installation directory:

```sh
cd /opt/lunedo
./lunedo update
```

`./lunedo update 1.5.0` updates to a given version, `--image <reference>` to another image, for example from a mirror registry, and `--yes` skips the confirmation. The command:

1. downloads the image of the target version, without changing the running instance;
2. stops when the target is the installed version, or older: a downgrade is done by [restoring a backup](#rollback), never by the update command;
3. shows the breaking changes, manual steps and other changes of every release since the installed version, and stops when the target cannot be reached directly;
4. asks for confirmation;
5. creates a backup of the class "before update" with the running version and stops if that fails, so that nothing changes;
6. records that this backup is done, so that the new version does not take a second one when it starts;
7. starts the new version and waits until it is ready, at most `LUNEDO_READY_TIMEOUT` seconds, 600 by default. Set it in the shell for a slow start, for example `LUNEDO_READY_TIMEOUT=1200 ./lunedo update`;
8. reports the result, records the new and the previous version in `.lunedo-install` and replaces itself with the `lunedo` command of the new version.

If the new version does not become ready, the command stops, prints the last log lines and the commands for the [rollback](#rollback) with the name of its backup. It never restores anything on its own.

The update command works only in an installation the setup script made; it refuses other directories. It runs on the host, where it can pull images and restart containers, which Lunedo inside its container cannot. Installation and update are the same file, so they cannot drift apart.

## With your own Compose file

1. Create a backup:

   ```sh
   docker compose exec lunedo lunedo backup create --before-update
   ```

   It prints where it wrote the backup. Without this step, the new version takes the same backup itself when it starts, before its migrations.
2. Read the breaking changes and manual steps of the new version, as described in [Before you update](#before-you-update).
3. Change the image in `compose.yml` to the new version, for example `ghcr.io/lunedo/lunedo:1.5.0`.
4. Pull and start it:

   ```sh
   docker compose pull
   docker compose up -d --wait
   ```

With another installation method, take a backup first with `lunedo backup create --before-update`, then start every Lunedo container with the new image.

## Backups before updates

When a process starts and migrations are pending, Lunedo first writes a backup of the class "before update" to the backup target and waits for it, logging its progress every 30 seconds. Only the first process applies migrations; the others wait. The backup carries the schema version of the database before the update, so the previous version can restore it.

- While no backup target is set up, or while a restored instance waits for its target to be confirmed, the backup goes to `LUNEDO_BACKUP_DIR` (`backups/` in the installation directory of the setup script), and the log says so.
- These backups and the deletions of their retention are recorded in the audit log like other backups, with the class "before update". The retention keeps the number set under **Backups before updates** in the backup settings.
- A fresh installation without migrations applied takes no backup.

If the backup fails, the migrations are not run and the process stops with the reason and the command to start once without it:

```sh
docker compose run --rm lunedo backup skip-before-update
```

The request is written to the work directory and applies only to the next start of the version it was made for: the version of the image the command runs in, or the one given with `--for-version 1.4.2`. Every start removes it, whether migrations are pending or not, and a request for another version is ignored and logged. A request that a patch release without migrations did not need therefore never skips the backup of a later update.

Update scripts can take the backup themselves before pulling a new image:

```sh
docker compose exec lunedo lunedo backup create --before-update
```

It writes a "before update" backup to the target (or to `LUNEDO_BACKUP_DIR`), applies the retention of that class and prints only the location on standard output: a path, or `s3://<bucket>/<key>`. Messages go to standard error. Run `backup skip-before-update --for-version <new version>` afterwards if the first start of the new version should not take a second backup; `./lunedo update` does this.

The setting **Back up before migrations** under **Settings › Instance › Operations › Backups**, section **Before updates**, and the environment variable `LUNEDO_BACKUP_BEFORE_UPDATE=false` turn the backup off for installations with their own backup strategy. The backup settings show which of them did, and the [system status](system-status.md#backups) shows that it is off. See [Backups](backups.md).

## Rollback

Migrations only go forward, so going back means restoring the backup from before the update with the previous version.

1. Set the image in `compose.yml` back to the previous version.
2. Stop Lunedo, restore the backup and start it again:

   ```sh
   cd /opt/lunedo
   docker compose stop lunedo
   docker compose run --rm lunedo backup restore --input /var/lib/lunedo/backups/<backup before the update> --force
   docker compose up -d --wait
   ```

The update command prints these commands with the name of its backup when an update fails. `backups/` in the installation directory is `/var/lib/lunedo/backups` in the container. A backup in S3 storage must be downloaded to the `backups` directory first.

`--force` replaces the database and the files with the content of the backup; changes made after the backup are lost. The `.env` with the keys stays as it is. After the restore, scheduled backups are paused until an instance administrator confirms the backup target. See [Restore](restore.md) and [Backup reference](backup-reference.md).

## Update check

The update check tells instance administrators about new versions. The worker downloads the public version file, by default `https://github.com/lunedo/lunedo/releases/latest/download/lunedo-versions.json`:

- every day at 04:11 UTC;
- when it starts and the last check is more than a day old;
- when the setting **Check for updates** changes;
- with **Check now** under **Settings › Instance › Operations › Updates**.

The request carries no data about the instance: no address, no version, no identifier, only the HTTP request itself with the user agent `Lunedo update check`. When a new version is found, instance administrators get a notification once per version. A failed check is shown on the updates page with its reason and logged as one warning; the next check runs a day later, or at once with **Check now**.

The check is on by default.

- Turn it off with **Check for updates** under **Settings › Instance › Operations › Updates**.
- Turn it off completely with `LUNEDO_UPDATE_CHECK=false`. Then Lunedo makes no request for it at all, and the setting cannot turn it on.
- Point it to a mirror with `LUNEDO_UPDATE_CHECK_URL`. A mirror in a private network must be listed in `LUNEDO_OUTBOUND_ALLOWED_NETWORKS`; public addresses must use HTTPS. The updates page shows only the scheme, host and path of the address.

The update commands on the updates page come from Lunedo, never from the version file, and text from the file is shown as plain text only.

### What's new

**What's new** on the updates page shows the section of the running version from the changelog in the image. It works with the update check off and without network access.
