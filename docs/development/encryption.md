# Encryption internals

This page describes the encryption formats, how modules register encrypted data and how key rotation finds it. The operator view, with the keys, their backup and rotation commands, is in [Encryption](../admin/encryption.md).

The code lives in `packages/server/src/crypto/`. Both formats use AES-256-GCM, with a random 256-bit data key per value or stream, wrapped with a master key (or, for backups, the backup key). Key material is held in `SecretKey`, whose string, JSON and inspect forms are redacted.

## Key providers

`KeyProvider` (`key-provider.ts`) loads the master key ring and, where the provider manages keys itself, adds a version:

| Provider | `load` | `addVersion` |
|---|---|---|
| `EnvKeyProvider` (`env`) | Parses `LUNEDO_MASTER_KEYS`. | Throws: operators add versions and restart. |
| `FileKeyProvider` (`file`) | Reads the key file; creates version 1 only with `create: true`. | Appends the next version through a temporary file and a rename. |

Only these two exist. A provider for an external key service would implement the same interface. `KeyRingHolder` holds the loaded ring of a process; `announce` sends the current version on the PostgreSQL channel `lunedo_key_ring`, and every subscribed process reloads, also after a lost notification connection.

At startup, `loadMasterKeyRing` (`key-usage.ts`) counts the versions that encrypted columns and streams use. It allows `create` only when nothing is encrypted yet, and fails when a version in use is missing from the ring.

## Envelope format

Values in the database are `bytea` columns created with `encrypted()` and written with `Encryption.encrypt(value, context)`:

| Offset | Length | Content |
|---|---|---|
| 0 | 3 | Magic `LDE` |
| 3 | 1 | Format version, 1 |
| 4 | 4 | Master key version, big endian |
| 8 | 12 | IV for wrapping the data key |
| 20 | 32 | Data key, encrypted with the master key |
| 52 | 16 | Authentication tag of the wrapped key; the wrap authenticates bytes 0–7 |
| 68 | 12 | IV of the data |
| 80 | n | Data, encrypted with the data key |
| end − 16 | 16 | Authentication tag of the data; it covers bytes 0–3 and the caller's context |

The context names the place of the value, for example table, column and row, so a value copied to another row fails to decrypt. `Encryption.rewrap` replaces bytes 4–67 and leaves the data untouched.

## Stream format

Large data (stored files, backups, the staged database dump) is encrypted in chunks, so it never has to fit in memory. Every stream starts with an 84-byte header:

| Offset | Length | Content |
|---|---|---|
| 0 | 3 | Magic `LDS` |
| 3 | 1 | Format version, 1 |
| 4 | 1 | Key kind: 1 master key, 2 backup key |
| 5 | 8 | Key ID: the master key version in bytes 4–7, or the backup key version in bytes 0–3 and the first 4 bytes of its fingerprint |
| 13 | 12 | IV for wrapping the data key |
| 25 | 32 | Data key, encrypted with the key named by the key ID; the wrap authenticates bytes 0–12 |
| 57 | 16 | Authentication tag of the wrapped key |
| 73 | 7 | Random nonce prefix |
| 80 | 4 | Chunk size, big endian |

The chunks follow the header. Each chunk is framed as:

| Length | Content |
|---|---|
| 1 | Final flag, 0 or 1 |
| 4 | Length of ciphertext and tag, big endian |
| n | Ciphertext and 16-byte tag |

The default chunk size is 64 KiB, the largest allowed 16 MiB. Each chunk is encrypted under the data key. Its nonce combines the prefix, a chunk counter (uint32) and the final flag, and its authentication covers the caller's associated data (for backups, the unencrypted backup header) and bytes 0–4 and 73–83 of the stream header. Reordered, missing, truncated or appended chunks are detected.

Bytes 5–72 have a fixed size and are protected by the wrap itself. Rotation replaces them in place without touching the chunks. Putting another stream's wrapped key there yields a different data key, so every chunk fails to decrypt.

## Encrypted columns

Every `encrypted()` column is listed in `encryptedColumns` in `packages/server/src/crypto/encrypted-column.ts`, so that rotation, the startup check and backups find it:

| Table | ID column | Column |
|---|---|---|
| `audit_subject_keys` | `subject_id` | `key` |
| `chat_channels` | `id` | `target` |
| `chat_channels` | `id` | `signing_secret` |
| `identity_provider_credentials` | `id` | `secret` |
| `identity_provider_secrets` | `provider_id` | `directory_key` |
| `import_connections` | `id` | `token` |
| `import_credentials` | `import_id` | `token` |
| `instance_secrets` | `name` | `value` |
| `mail_credentials` | `id` | `secret` |
| `mail_outbox` | `id` | `message` |
| `push_subscriptions` | `id` | `subscription` |
| `share_links` | `id` | `secret` |
| `totp_credentials` | `id` | `secret` |

A new encrypted column is added to the list together with its schema change. `encrypted-column.test.ts` fails when a column of the schema is missing from the list. Hashes and other binary values that are not encrypted use `bytes()` instead.

## Encrypted streams

Data stored with the stream format under a master key is registered through an `EncryptedStreamOwner` (`encrypted-stream.ts`):

```ts
export interface EncryptedStreamOwner {
  name: string;
  versions?(context: EncryptedStreamContext): Promise<Record<number, number>>;
  streams(context: EncryptedStreamContext, targetVersion?: number): AsyncIterable<EncryptedStream>;
}
```

- `versions` returns the number of streams per master key version without reading every header. Without it, the callers read the header of every stream.
- `streams` lists the streams; with `targetVersion`, it may leave out streams already at that version. Each stream has `readHeader()` and `writeHeader(header)`, which replaces the header in place.

The owners come from `encryptedStreamOwnersOf(store)` in `packages/server/src/files/owners.ts`. Today it returns one owner, `fileStreamOwner` (`files/files.ts`), for the stored files in the local or S3 file store; it keeps the master key version of each file in `stored_files.master_key_version`. A module that stores stream-encrypted data elsewhere adds its owner there. Rotation, `keys status`, the startup check and the master key list in backup headers include these streams.

## Key rotation

`rotateMasterKey` (`rotation.ts`) takes the advisory lock `lunedo.key-rotation`, adds a version with the file provider, reloads and announces the ring, and starts a rotation: a row in `key_rotations` and the job `encryption.rotate-data-keys` (10 retries, 30 seconds apart, waits during maintenance mode). Concurrent calls are serialized by the lock. Backups take the same lock in shared mode.

The job reloads the ring and re-wraps to its current version, which may be newer than the version the rotation started with:

1. For each encrypted column, it re-wraps batches of 200 rows whose version differs, selected with `for update skip locked`, and adds the count to `key_rotations.rewrapped`.
2. It goes through the streams of every owner twice and re-wraps every header with another version, so that files written during the first pass are covered.
3. It counts the values that still use another version. When there are any, the job fails and is retried; otherwise the rotation is marked `completed`.

The job is safe to run again after an interruption. `KeyRotation.status()` returns the current version, the values per version and the latest rotation, which `keys status` and the system status show.
