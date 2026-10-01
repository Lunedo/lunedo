# Backups

A backup contains the database, the file store and the configuration. It never contains the master keys or the backup key: keep those separately, for example by backing up the secrets directory to another place. **A backup cannot be restored without the backup key, and encrypted values in it cannot be read without the master keys.**

## Commands

The commands run inside the image, with the same configuration as the instance:

```sh
docker compose exec pagehall pagehall backup create --output /var/lib/pagehall/backups/pagehall.phbak
docker compose exec pagehall pagehall backup verify --input /var/lib/pagehall/backups/pagehall.phbak
docker compose run --rm pagehall backup restore --input /var/lib/pagehall/backups/pagehall.phbak
```

- `create` writes the backup. The output directory must be writable by the container user; `/var/lib/pagehall/backups` is.
- `verify` decrypts the whole backup and checks the manifest and every checksum without restoring anything.
- `restore` restores into an empty instance: an empty database and an empty file store. It verifies the backup first. It refuses to overwrite existing data unless `--force` is given, which drops all database schemas and empties the file store first. `--config-dir <dir>` writes the configuration files from the backup to a directory for review; they are never applied automatically.

Stop the application before restoring. After the restore, start Pagehall; it applies migrations if the backup is from an older version. Backups from a newer schema version than the running Pagehall are refused.

Exit codes: 0 success, 1 failure, 64 invalid command, 78 invalid configuration.

## Format

A backup file (`.phbak`) is a gzip-compressed tar archive, encrypted as a whole with the stream format described in [encryption.md](encryption.md) under the backup key (key kind 2, identified by a fingerprint of the key). Nothing about the content, including file names, is visible without the key, and any modification, truncation or appended data is detected.

The archive contains, in this order:

| Entry | Content |
|---|---|
| `database.dump` | `pg_dump` custom format of the whole database, without owners and privileges |
| `files/<path>` | Every regular file of the file store, by its path relative to `PAGEHALL_FILES_DIR` |
| `config/environment.json` | The settings from the environment; secret values are replaced by `[set]`, key settings are left out |
| `config/pagehall.json` | The configuration file, if one is used, without key settings |
| `manifest.json` | Always the last entry |

The manifest:

```json
{
  "format": 1,
  "pagehallVersion": "1.0.0",
  "schemaVersion": "0000_foundation",
  "createdAt": "2026-10-01T06:00:00.000Z",
  "entries": [{ "path": "database.dump", "size": 1234, "sha256": "…" }]
}
```

Verification and restore reject archives whose entries differ from the manifest, contain unknown entries, paths with `..` or absolute paths, or data after the manifest.

## PostgreSQL versions

`pg_dump` must be at least as new as the server, and dumps should be restored with the client that matches the target server. The image contains the clients for PostgreSQL 16, 17 and 18 and picks the one that matches the server's major version.

## Tests

CI creates a backup of an instance with sample data, verifies it, restores it into a fresh database and file store, compares both, and checks that a second restore is refused (`scripts/backup-roundtrip.sh`).

Schedules, retention, remote targets and the backup screens are not part of this version.
