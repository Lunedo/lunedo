# Encryption

Secrets that Pagehall stores in the database, such as identity provider secrets, SMTP credentials and TOTP secrets, are encrypted with envelope encryption. Attachments and backups use the same keys through a streaming format. Passwords and API tokens are hashed, never encrypted.

## Keys

- **Master keys** protect the data keys. They come from a key provider: the file provider (default, `master-keys` in the secrets directory, generated on first start) or the env provider (`PAGEHALL_MASTER_KEYS`). Further providers, such as HashiCorp Vault, OpenBao or a cloud KMS, implement the same `KeyProvider` interface.
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

Large data is encrypted in chunks of 64 KiB, so it never has to fit in memory. The header names the key kind (1 master key, 2 backup key) and the key ID (master key version or backup key fingerprint), and carries the wrapped data key and a random nonce prefix. Each chunk is encrypted with AES-256-GCM; its nonce combines the prefix, a chunk counter and a final-chunk flag, and its authentication covers the whole header. Reordered, missing, truncated or appended chunks are detected.

## Rotation

Rotating the master key re-wraps every data key with a new master key version. The encrypted data itself is not touched, so rotation is fast and safe to interrupt.

With the file provider:

```sh
docker compose exec pagehall pagehall keys rotate
docker compose exec pagehall pagehall keys status
```

`rotate` adds a new version to the key ring file, tells all running nodes to reload it, and starts a background job in the worker. New data is encrypted with the new version immediately. Values that still use an older version stay readable until the job has re-wrapped them. `status` shows the current version and the progress of the latest rotation. Remove an old version from the key ring only after the rotation is completed.

With the env provider, add the new version to `PAGEHALL_MASTER_KEYS` (keep the old ones), restart all nodes, and then run `pagehall keys rotate`.

## Encrypted columns

Every `encrypted()` column is listed in `encryptedColumns` in `packages/server/src/crypto/encrypted-column.ts`, so that rotation finds it:

```ts
export const encryptedColumns: readonly EncryptedColumn[] = [
  { table: "smtp_settings", idColumn: "id", column: "password" },
];
```

A test fails when a column of the schema is missing from the list.
