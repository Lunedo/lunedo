# Encryption

Secrets that Pagehall stores in the database, such as identity provider secrets, SMTP credentials and TOTP secrets, are encrypted with envelope encryption. Attachments and backups use the same keys through a streaming format. Passwords and API tokens are hashed, never encrypted.

## Keys

- **Master keys** protect the data keys. They come from a key provider: the file provider (default, `master-keys` in the secrets directory, generated on first start) or the env provider (`PAGEHALL_MASTER_KEYS`). Further providers, such as HashiCorp Vault, OpenBao or a cloud KMS, implement the same `KeyProvider` interface.

  At startup Pagehall counts the master key versions that encrypted columns and streams use. The file provider generates version 1 only while the database holds no encrypted data; otherwise a missing key file stops the start with a message, so that a lost key ring is never silently replaced by a new key. Pagehall also refuses to start when a key version in use is missing from the ring.
- **Data keys** are random 256-bit keys, one per encrypted value or stream. They are stored only in wrapped form, next to the data.
- **The backup key** encrypts backups and is separate from the master keys.

Key material never appears in logs, errors or test snapshots. Comparisons of secrets run in constant time.

## Envelope format

Values in the database are `bytea` columns created with `encrypted()`:

| Offset | Length | Content |
|---|---|---|
| 0 | 3 | Magic `PHE` |
| 3 | 1 | Format version, 1 |
| 4 | 4 | Master key version, big endian |
| 8 | 12 | IV for wrapping the data key |
| 20 | 32 | Data key, encrypted with the master key (AES-256-GCM) |
| 52 | 16 | Authentication tag of the wrapped key; it covers bytes 0–7 |
| 68 | 12 | IV of the data |
| 80 | n | Data, encrypted with the data key (AES-256-GCM) |
| end − 16 | 16 | Authentication tag of the data; it covers bytes 0–3 and the caller's context |

The context names the place of the value, for example table, column and row. A value copied to another row fails to decrypt.

## Stream format

Large data is encrypted in chunks of 64 KiB, so it never has to fit in memory. Every stream starts with an 84-byte header:

| Offset | Length | Content |
|---|---|---|
| 0 | 3 | Magic `PHS` |
| 3 | 1 | Format version, 1 |
| 4 | 1 | Key kind: 1 master key, 2 backup key |
| 5 | 8 | Key ID: the master key version in bytes 4–7, or the backup key version in bytes 0–3 and the first 4 bytes of its fingerprint |
| 13 | 12 | IV for wrapping the data key |
| 25 | 32 | Data key, encrypted with the key named by the key ID (AES-256-GCM); the wrap authenticates bytes 0–12 |
| 57 | 16 | Authentication tag of the wrapped key |
| 73 | 7 | Random nonce prefix |
| 80 | 4 | Chunk size, big endian |

Each chunk is encrypted with AES-256-GCM under the data key. Its nonce combines the prefix, a chunk counter and a final-chunk flag, and its authentication covers the caller's associated data (for backups, the unencrypted backup header) and bytes 0–4 and 73–83 of the stream header. Reordered, missing, truncated or appended chunks are detected.

Bytes 5–72 have a fixed size and are protected by the wrap itself. Rotation replaces them in place without touching the chunks. Putting another stream's wrapped key there yields a different data key, so every chunk fails to decrypt.

## Rotation

Rotating the master key re-wraps every data key with a new master key version: in encrypted database columns and in the headers of registered streams. The encrypted data itself is not touched, so rotation is fast and safe to interrupt. The rotation is reported as completed only when no column value and no stream uses an older version.

With the file provider:

```sh
docker compose exec pagehall pagehall keys rotate
docker compose exec pagehall pagehall keys status
```

`rotate` adds a new version to the key ring file, tells all running nodes to reload it, and starts a background job in the worker. New data is encrypted with the new version immediately. Values that still use an older version stay readable until the job has re-wrapped them. `status` shows the current version and the progress of the latest rotation. Remove an old version from the key ring only after the rotation is completed. Rotations started at the same time are serialized: each adds its own version, and the background job always re-wraps to the newest one.

With the env provider, add the new version to `PAGEHALL_MASTER_KEYS` (keep the old ones), restart all nodes, and then run `pagehall keys rotate`.

## Encrypted columns

Every `encrypted()` column is listed in `encryptedColumns` in `packages/server/src/crypto/encrypted-column.ts`, so that rotation finds it:

```ts
export const encryptedColumns: readonly EncryptedColumn[] = [
  { table: "chat_channels", idColumn: "id", column: "target" },
  { table: "instance_secrets", idColumn: "name", column: "value" },
  { table: "mail_outbox", idColumn: "id", column: "message" },
  { table: "push_subscriptions", idColumn: "id", column: "subscription" },
  { table: "totp_credentials", idColumn: "id", column: "secret" },
];
```

A test fails when a column of the schema is missing from the list. Hashes and other binary values that are not encrypted use `bytes()` instead.

## Encrypted streams

Modules that store data with the stream format under a master key, such as attachments, add an owner to `encryptedStreamOwners` in `packages/server/src/crypto/encrypted-stream.ts`. An owner lists its streams and gives rotation access to their headers:

```ts
export const encryptedStreamOwners: readonly EncryptedStreamOwner[] = [
  {
    name: "attachments",
    async *streams({ database, filesDir }) {
      for (const attachment of await listAttachments(database)) {
        yield {
          id: attachment.id,
          readHeader: () => readFirstBytes(path.join(filesDir, attachment.path), STREAM_HEADER_LENGTH),
          writeHeader: (header) => writeAt(path.join(filesDir, attachment.path), 0, header),
        };
      }
    },
  },
];
```

Rotation, `keys status` and the master key checks of backups and startup include these streams.
