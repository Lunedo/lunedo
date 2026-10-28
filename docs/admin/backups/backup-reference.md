# Backup reference

This page describes how the backup commands run, the backup file format and the database connection rules of the backup tools. How to set up backups is described in [Backups](../backups.md), how to restore in [Restoring a backup](restore.md).

## Commands

The commands run inside the image, with the same configuration as the instance, for example `docker compose exec lunedo lunedo backup …` while Lunedo runs, or `docker compose run --rm lunedo backup …` while it is stopped. In an installation of the setup script, `./lunedo backup …` in the installation directory runs `lunedo backup …` in the running container.

[Command line](../cli.md#lunedo-in-the-image) lists the backup commands `backup create`, `backup create --before-update`, `backup skip-before-update`, `backup verify` and `backup restore` with their options and exit codes.

`verify` and `restore` read local files only. `create`, also with `--before-update`, refuses to run while an earlier restore is incomplete; run `restore` again with `--force` to complete it (see [How a restore changes the instance](restore.md#how-a-restore-changes-the-instance)).

## File names

Backups in a target are named `lunedo-backup-<UTC time>-<class>-<random>.ldbak`, for example `lunedo-backup-20261021T020000Z-daily-3f0c8a1b.ldbak`. The class is `daily`, `weekly`, `monthly`, `manual` or `before-update`. Retention and the list on the backup page only consider files with such a name. `backup create --output` uses the file name you give.

While a backup is written to a directory, it has the name of the backup followed by a random part and `.partial`; it is renamed when it is complete.

## File format

A backup file (`.ldbak`) starts with an unencrypted header, followed by an encrypted stream:

| Offset | Length | Content |
|---|---|---|
| 0 | 4 | Magic `LDBK` |
| 4 | 2 | Format version, 1, big endian |
| 6 | 4 | Length n of the header JSON, big endian |
| 10 | n | Header JSON, UTF-8, at most 64 KiB |
| 10 + n | rest | Encrypted stream under the backup key (key kind 2) |

The header JSON:

```json
{
  "lunedoVersion": "1.0.0",
  "schemaVersion": "0105_portal_instance_numbers",
  "createdAt": "2026-10-21T02:00:00.000Z",
  "key": { "version": 1, "fingerprint": "3f0c8a1b2d4e6f70" },
  "masterKeys": [{ "version": 1, "fingerprint": "9a7e51c04b3d2f18" }],
  "cipher": "AES-256-GCM",
  "chunkSize": 65536,
  "instanceUrl": "https://wiki.example.com"
}
```

| Field | Content |
|---|---|
| `lunedoVersion` | Version of Lunedo that created the backup. |
| `schemaVersion` | The latest database migration in the backup. |
| `createdAt` | Creation time. |
| `key` | Version and fingerprint of the backup key. |
| `masterKeys` | Every master key version that encrypted data in the backup uses, with its fingerprint. |
| `cipher`, `chunkSize` | Cipher and chunk size of the encrypted stream. |
| `scope` | `"database"` for a backup without the file store; left out for a backup with everything. |
| `instanceUrl` | The address of the instance that made the backup, when it had one. |

A fingerprint identifies a key without revealing it: the first 8 bytes of SHA-256 over `lunedo-backup-key` (or `lunedo-master-key` for master keys) and the key, in hex.

The header is readable without the key, so a backup can be identified and checked before decryption. It is authenticated: the first 10 + n bytes are part of the authenticated data of every encrypted chunk, so any change to the header makes decryption fail. A backup is only created when the master key ring of the instance contains every master key version that its data uses.

The encrypted stream contains a gzip-compressed tar archive with these entries, in this order:

| Entry | Content |
|---|---|
| `database.dump` | `pg_dump` custom format of the whole database, without owners and privileges. |
| `files/<path>` | Every regular file of the file store, by its path relative to `LUNEDO_FILES_DIR`. With S3 file storage, the objects of the bucket follow as `files/attachments/<key>`. Left out in a backup without the file store. |
| `config/lunedo.json` | The configuration file, if one is used, without the key settings. |
| `config/environment.json` | The settings from the environment, see below. |
| `manifest.json` | Always the last entry. |

The manifest repeats the versions and the creation time of the header and lists every entry with its size and SHA-256 checksum:

```json
{
  "format": 1,
  "lunedoVersion": "1.0.0",
  "schemaVersion": "0105_portal_instance_numbers",
  "createdAt": "2026-10-21T02:00:00.000Z",
  "entries": [{ "path": "database.dump", "size": 1048576, "sha256": "…" }]
}
```

Verification and restore reject a backup when:

- an entry is a symbolic link, a hard link, a device file, a named pipe or a directory;
- an entry path is absolute, contains `..` or empty segments, or lies outside `database.dump`, `files/` and `config/`;
- a backup without the file store contains `files/` entries;
- entries differ from the manifest, data follows the manifest, the manifest is missing, or the manifest does not match the header.

Because the whole backup is verified before anything is written, a rejected backup leaves the instance untouched.

## Configuration in a backup

| File | Content |
|---|---|
| `config/lunedo.json` | The file named by `LUNEDO_CONFIG_FILE`, with `LUNEDO_MASTER_KEYS`, `LUNEDO_MASTER_KEYS_FILE`, `LUNEDO_MASTER_KEYS_PATH`, `LUNEDO_BACKUP_KEY` and `LUNEDO_BACKUP_KEY_FILE` removed. Every other value is kept as it is, including secrets such as an SMTP password or the password in `LUNEDO_DATABASE_URL`. |
| `config/environment.json` | Every known setting that is set in the environment, except the key settings above. The values of secret settings are replaced by `[set]`; the paths of their `_FILE` variants are kept. |

Both files are inside the encrypted stream. Treat a backup of an instance that keeps secrets in its configuration file like those secrets. A restore writes these files only with `--config-dir` and never applies them.

## Errors of the backup API

Deleting a backup, starting a test restore and **Back up now** answer with the problem `backupTargetFailed` (status 502) when the target cannot be used. Its `problem` field names the cause (`notFound`, `permission`, `readOnly`, `full`, `dns`, `blockedAddress`, `insecureAddress`, `connection`, `tls`, `credentials`, `bucket`, `missingSecret` and others), `step` names the step, and the detail says what to do. The routes are described at `/api/docs` of your instance.

## Database connection

The backup tools (`pg_dump`, `pg_restore`, `psql`) use the same `LUNEDO_DATABASE_URL` as the application. They get the credentials through the environment, never on the command line, and they verify TLS at least as strictly as the application:

| URL parameters | Backup tools (`PGSSLMODE`) |
|---|---|
| no TLS parameters | not set; the libpq default `prefer` is not weaker than the application, which connects without TLS |
| `sslmode=disable`, also with certificate parameters | `disable` |
| `sslmode=prefer`, `require`, `verify-ca` or `verify-full`, `ssl=true` or `ssl=1`, or any of `sslrootcert`, `sslcert`, `sslkey` | `verify-full`, because the application verifies the certificate and host name for these |
| `sslmode=no-verify` | `require` |
| `uselibpqcompat=true&sslmode=prefer` | `require`, because the application requires TLS and never falls back to plaintext |
| `uselibpqcompat=true&sslmode=require` | `require`; `verify-ca` when `sslrootcert` is given |
| `uselibpqcompat=true&sslmode=verify-ca` | `verify-ca` |
| `uselibpqcompat=true` with `sslmode=verify-full`, `sslmode=no-verify`, or no `sslmode` but `ssl=true` or certificate parameters | `verify-full` |

Certificate files are passed as `PGSSLROOTCERT`, `PGSSLCERT` and `PGSSLKEY`, and `application_name` as `PGAPPNAME`.

Other URL parameters, other `sslmode` values and other values of `ssl` stop the command with a message that names the parameter.

## PostgreSQL versions

`pg_dump` must be at least as new as the server, and a dump should be restored with the client that matches the target server. The image contains the clients for PostgreSQL 16, 17 and 18 and picks the one that matches the major version of the server. To move to a new major version, see [Upgrading PostgreSQL to a new major version](restore.md#upgrading-postgresql-to-a-new-major-version).
