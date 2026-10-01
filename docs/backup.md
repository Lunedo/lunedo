# Backups

A backup contains the database, the file store and the configuration. It never contains the master keys or the backup keys: keep those separately, for example by backing up the secrets directory to another place. **A backup cannot be restored without its backup key, and encrypted values in it cannot be read without the master keys.**

## Commands

The commands run inside the image, with the same configuration as the instance:

```sh
docker compose exec pagehall pagehall backup create --output /var/lib/pagehall/backups/pagehall.phbak
docker compose exec pagehall pagehall backup verify --input /var/lib/pagehall/backups/pagehall.phbak
docker compose run --rm pagehall backup restore --input /var/lib/pagehall/backups/pagehall.phbak
```

- `create` writes the backup. The output directory must be writable by the container user; `/var/lib/pagehall/backups` is.
- `verify` checks the header, decrypts the whole backup and checks the manifest and every checksum without restoring anything.
- `restore` restores into an empty instance: an empty database and an empty file store. It verifies the backup first. It refuses to overwrite existing data unless `--force` is given, which drops all database schemas and empties the file store first. `--config-dir <dir>` writes the configuration files from the backup to a directory for review; they are never applied automatically.

Stop the application before restoring. After the restore, start Pagehall; it applies migrations if the backup is from an older version.

Exit codes: 0 success, 1 failure, 64 invalid command, 78 invalid configuration.

## Backup keys

Backup keys form a key ring like the master keys (`PAGEHALL_BACKUP_KEY`, or `backup-keys` in the secrets directory, generated on first start). New backups use the highest version. To change the backup key, add a new version and keep the old ones for as long as backups made with them are kept.

## Checks before restoring

`verify` and `restore` read the header first and stop before reading any data when:

| Situation | Message |
|---|---|
| The file is not a backup | `<file> is not a Pagehall backup` |
| Unknown format version | `The backup uses format version <n>, which this Pagehall version cannot read. Restore it with the Pagehall version that created it or a newer one.` |
| Newer schema version | `The backup was created by Pagehall <version> with schema version <schema>, which is newer than this Pagehall version supports. Update Pagehall to version <version> or newer and run the command again.` |
| Backup key version missing | `The backup is encrypted with backup key version <n> (fingerprint <f>), which is not configured. Add this key version to PAGEHALL_BACKUP_KEY or to the backup-keys file in the secrets directory and run the command again.` |
| Different key under that version | `The backup is encrypted with backup key version <n> (fingerprint <f>), but the configured key version <n> has fingerprint <g>. Configure the key the backup was created with.` |

The fingerprint identifies a key without revealing it: the first 8 bytes of SHA-256 over `pagehall-backup-key` and the key, in hex.

## Format

A backup file (`.phbak`) starts with an unencrypted header, followed by an encrypted stream:

| Offset | Length | Content |
|---|---|---|
| 0 | 4 | Magic `PHBK` |
| 4 | 2 | Format version, 1, big endian |
| 6 | 4 | Length n of the header JSON, big endian |
| 10 | n | Header JSON, UTF-8 |
| 10 + n | rest | Encrypted stream (see [encryption.md](encryption.md)), key kind 2 (backup key) |

The header JSON:

```json
{
  "pagehallVersion": "1.0.0",
  "schemaVersion": "0000_foundation",
  "createdAt": "2026-10-01T06:00:00.000Z",
  "key": { "version": 1, "fingerprint": "3f0c8a1b2d4e6f70" },
  "cipher": "AES-256-GCM",
  "chunkSize": 65536
}
```

The header is readable without the key, so a backup can be identified and checked before decryption. It is authenticated: the first 10 + n bytes are part of the authenticated data of every encrypted chunk, so any change to the header makes decryption fail.

The encrypted stream contains a gzip-compressed tar archive with these entries, in this order:

| Entry | Content |
|---|---|
| `database.dump` | `pg_dump` custom format of the whole database, without owners and privileges |
| `files/<path>` | Every regular file of the file store, by its path relative to `PAGEHALL_FILES_DIR` |
| `config/environment.json` | The settings from the environment; secret values are replaced by `[set]`, key settings are left out |
| `config/pagehall.json` | The configuration file, if one is used, without key settings |
| `manifest.json` | Always the last entry |

The manifest repeats the versions and creation time of the header and lists every entry with its size and SHA-256 checksum:

```json
{
  "format": 1,
  "pagehallVersion": "1.0.0",
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

## PostgreSQL versions

`pg_dump` must be at least as new as the server, and dumps should be restored with the client that matches the target server. The image contains the clients for PostgreSQL 16, 17 and 18 and picks the one that matches the server's major version.

## Tests

CI creates a backup of an instance with sample data, verifies it, restores it into a fresh database and file store, compares both, and checks that a second restore is refused (`scripts/backup-roundtrip.sh`).

Schedules, retention, remote targets and the backup screens are not part of this version.
