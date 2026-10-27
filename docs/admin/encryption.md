# Encryption

Lunedo encrypts the secrets it stores in the database, the files in its file store and its backups. This page explains what is encrypted, which keys exist, how to back them up and how to rotate them. The formats are described for developers in [Encryption internals](../development/encryption.md).

## What is encrypted

- **Secrets in the database**, with envelope encryption under the master keys. Among them: the secrets of identity providers, mail server credentials, the TOTP secrets of accounts, the tokens of import connections, the targets and signing secrets of chat channels, push subscriptions, secrets of share links, the secret key of an S3 backup target, the Teams webhook of the operations contacts, queued e-mails and the keys that protect personal data in the audit log.
- **Files in the file store**, such as attachments, in local storage and in S3-compatible storage alike, with the same keys through a streaming format.
- **Backups**, with the backup key (see [Backups](backups.md)).

Passwords and API tokens are hashed, never encrypted. Key material never appears in logs or errors, and comparisons of secrets run in constant time.

Each encrypted value has its own random 256-bit data key, which is stored next to the data, wrapped with a master key. Each value is bound to its place, for example its table, column and row, so a value copied to another row cannot be decrypted.

## Keys

### Master keys

The master keys protect the data keys of everything Lunedo stores. They come from a key provider:

| Provider | Source | Chosen when |
|---|---|---|
| `env` | `LUNEDO_MASTER_KEYS` (or `LUNEDO_MASTER_KEYS_FILE`) | `LUNEDO_MASTER_KEYS` is set. The setup script writes it to the `.env` file of the installation. |
| `file` | The file `master-keys` in the secrets directory (`LUNEDO_SECRETS_DIR`, by default `/var/lib/lunedo/secrets`), or the file given by `LUNEDO_MASTER_KEYS_PATH`. | `LUNEDO_MASTER_KEYS` is not set. |

`LUNEDO_KEY_PROVIDER` sets the provider explicitly. Other providers, for example for a key management service, can be added through the same provider interface; Lunedo ships only these two.

The file provider generates version 1 on the first start, and only while the database holds no encrypted data. When the database holds encrypted data and the key file is missing, Lunedo refuses to start with a message, so that a lost key ring is never silently replaced by a new key. Lunedo also refuses to start when a key version that stored data uses is missing from the ring.

Generated keys are never written to logs. Several nodes can start at the same time on a shared secrets directory; exactly one generated key is kept. With several nodes and no shared volume, configure the master keys and the backup key explicitly.

### Backup keys

The backup key encrypts backups and is separate from the master keys: `LUNEDO_BACKUP_KEY` (or `LUNEDO_BACKUP_KEY_FILE`), or the file `backup-keys` in the secrets directory, which Lunedo generates on the first start when the key is not configured. The setup script writes `LUNEDO_BACKUP_KEY` to `.env`.

### Key rings

Master keys and backup keys are key rings: one or more versions of a key, one `<version>:<base64 key>` entry per line, or separated by commas in an environment variable, for example `LUNEDO_MASTER_KEYS=1:<key>,2:<key>`. Each key is 32 random bytes. The highest version encrypts new data; older versions stay available to read data and backups created with them. Generate a key with:

```sh
openssl rand -base64 32
```

## Backing up the keys

**Without the backup key, no backup can be restored. Without the master keys, the secrets in a backup and the files of the file store cannot be read.** Backups never contain the keys, so keep a copy of both key rings outside the server, for example in a password manager, and separately from the backups.

Where the keys are depends on the installation:

| Installation | Master keys | Backup key | What to keep |
|---|---|---|---|
| Setup script | `LUNEDO_MASTER_KEYS` in `.env` | `LUNEDO_BACKUP_KEY` in `.env` | The `.env` file of the installation directory. The script says so at the end of the installation. |
| Own configuration with key settings | `LUNEDO_MASTER_KEYS` | `LUNEDO_BACKUP_KEY` | The values you configured. |
| No key settings | `master-keys` in the secrets directory | `backup-keys` in the secrets directory | The secrets directory, or at least these two files. |

### Emergency kit

The setup assistant has a required step **Emergency kit**. It offers one download of a text file, `lunedo-emergency-kit-<host>.txt` (named in the language of the setup). The file holds the instance URL, the date, ten new recovery codes of the owner, `LUNEDO_MASTER_KEYS` and `LUNEDO_BACKUP_KEY`, each with a sentence on what it is for. The recovery codes are created when the kit is downloaded; changing the owner account afterwards makes them invalid, so the step asks for a new kit. Confirming the step also confirms the backup key on the backups page. Outside the setup the two stay separate: new recovery codes come from the account settings, the keys from the server.

The emergency kit holds the keys as they were at the time of the setup. After a rotation or a new backup key version, back up the new key rings as well.

When the instance is set up through configuration, the assistant and its emergency kit step are skipped, and the operator must back up the master keys and the backup keys. See [Setup through configuration](setup-through-configuration.md).

### When a key is lost

- **Master keys lost, database intact:** Lunedo refuses to start, because it never replaces a key ring while encrypted data exists. Restore the key ring from your copy.
- **Master keys lost together with the server:** a backup can be restored only with the master key ring of the instance it comes from. Without it, the restore stops before it changes anything.
- **Backup key lost:** the backups encrypted with it cannot be restored. New backups use the key that is configured now.

Key versions that are still needed must stay in the ring: a restore stops when the backup uses a master key version or a backup key version that is not configured (see [Checks before restoring](restore.md#checks-before-restoring)).

## Rotating the master key

Rotating the master key re-wraps every data key with a new master key version: in the encrypted database columns and in the headers of the stored files. The encrypted data itself is not touched, so rotation is fast and safe to interrupt. New data is encrypted with the new version as soon as the nodes have loaded it. Values that still use an older version stay readable until the background job has re-wrapped them.

### With the file provider

```sh
docker compose exec lunedo lunedo keys rotate
docker compose exec lunedo lunedo keys status
```

`keys rotate` adds a new version to the key ring file, tells all running nodes to reload it, and starts a background job in the worker. Rotations started at the same time are serialized: each adds its own version, and the background job always re-wraps to the newest one. The job waits while maintenance mode is on.

### With the env provider

This applies to installations of the setup script.

1. Generate a key with `openssl rand -base64 32`.
2. Add it as the next version to `LUNEDO_MASTER_KEYS` and keep the old versions, for example `LUNEDO_MASTER_KEYS=1:<old key>,2:<new key>`.
3. Restart all nodes with the new value. With the setup script, run `docker compose up -d` in the installation directory, which recreates the container with the changed `.env`.
4. Start the rotation:

   ```sh
   docker compose exec lunedo lunedo keys rotate
   ```

5. Back up the changed `.env`.

### Progress

`keys status` prints the current version, the versions in the ring and the latest rotation:

```
Current master key version: 2
Available versions: 1, 2
Latest rotation: to version 2, completed, 1480 values re-wrapped
```

The latest rotation is `running` or `completed`. A rotation is reported as completed only when no column value and no stored file uses an older version. The system status shows a running rotation as well.

### Removing an old key version

Remove an old version from the key ring only when both are true:

- `keys status` reports the latest rotation as `completed`;
- no backup that you still keep was created before the rotation completed, because such a backup lists the old version in its header and cannot be restored without it.

Until then, keep every version. Lunedo refuses to start when stored data uses a version that is missing from the ring.

## Changing the backup key

There is no command for the backup key. To change it:

1. Generate a key with `openssl rand -base64 32`.
2. Add it as the next version to `LUNEDO_BACKUP_KEY` (comma-separated) or as a new line to `backup-keys`, and keep the old versions.
3. Restart all nodes. New backups use the highest version.
4. Back up the new key ring and confirm it again on the backups page.

Keep the old versions for as long as backups made with them are kept.

## Status messages

The item **Encryption** of the [system status](system-status.md#encryption) reports:

| Reason | Meaning |
|---|---|
| none | Master key version *n* is loaded. |
| `masterKeyMissing` | The master key is not loaded. Check the key settings and restart. |
| `keysNotBackedUp` | Only with the file provider: the master keys are stored only in the secrets volume, and the emergency kit step of the setup was not completed. Copy the secrets directory to a safe place. |
| `rotationRunning` | A key rotation is running. |

## Startup checks

At startup Lunedo counts the master key versions that the encrypted columns and the stored files use, and stops with a message when:

- encrypted data exists and no master key ring is available: `The database contains data encrypted with master key version <n>, but no master key ring is available: … Restore the master key ring of this instance (master-keys in the secrets directory, or LUNEDO_MASTER_KEYS) and start Lunedo again. A new key is never created while encrypted data exists.`
- a version in use is missing from the ring: `Stored data uses master key version <n>, which the master key ring does not contain. Restore the complete master key ring of this instance and start Lunedo again.`
