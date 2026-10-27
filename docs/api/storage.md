# Storage

Read the usage of the file store and change the storage warnings, and read how much storage an organization or a space uses. [File storage](../admin/storage.md) explains the warning levels for administrators. The full reference is at `/api/docs` on your instance.

## Routes

| Route | What it does | Permission |
|---|---|---|
| `GET /api/v1/instance/storage` | Usage of the file store, the active level and the warning settings | `instance.settings.view` |
| `PUT /api/v1/instance/storage` | Changes the levels, the S3 limit, the reminder and the operations contacts | `instance.settings.manage` |
| `POST /api/v1/instance/storage/test` | Sends a test message to the operations contacts | `instance.settings.manage` |
| `GET /api/v1/organizations/{organizationId}/storage` | Storage used by the attachments of all spaces of an organization, with every stored version | `organization.spaces.view` |
| `GET /api/v1/spaces/{spaceId}/storage` | Storage used by the attachments of a space, with every stored version | `space.manage` |

Only the file store is measured: attachments, import uploads and finished exports. The database is not.

## Usage and settings

`GET /api/v1/instance/storage` returns:

| Field | Content |
|---|---|
| `store` | `local` or `s3` |
| `measured` | whether Lunedo can measure the usage; `false` for S3 storage without a limit, with `inactiveReason: "noLimit"` |
| `usedBytes`, `totalBytes`, `percent` | usage, size of the volume or the S3 limit, and the share in percent; `null` when not measured |
| `level` | the active level: `0` normal, `1` warning, `2` large exports and imports refused, `3` uploads refused too |
| `thresholds` | `warning`, `largeWrites` and `critical` in percent |
| `s3LimitBytes` | the limit for S3 storage, or `null` |
| `reminder` | how often an active level is announced again: `off`, `daily`, `weekly` or `monthly` |
| `operationsEmails` | e-mail addresses of the operations contacts |
| `teamsWebhook` | `configured` and the `host` of the optional Microsoft Teams webhook; the full address is never returned |
| `checkedAt` | when the usage was last checked |

`PUT` takes the same settings; leave out what stays as it is:

```sh
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"thresholds": {"warning": 75, "largeWrites": 88, "critical": 94}, "reminder": "weekly"}' \
  https://wiki.example.com/api/v1/instance/storage
```

- The three levels must rise from one to the next.
- `operationsEmails` replaces the whole list, up to 20 addresses.
- `teamsWebhook` sets the address, `null` removes it. It is stored encrypted.
- `s3LimitBytes: null` removes the limit.
- An invalid value is refused with `invalidStorageSettings`; `problem` names it: `invalidThresholds`, `invalidS3Limit`, `invalidContacts` or `invalidTeamsWebhook`.
- Changing the operations contacts is recorded in the audit log.

`POST …/storage/test` answers with the number of `addresses` that got a test message and, if a Teams webhook is set, whether Teams accepted it.

## Refused writes

| Problem | Status | When |
|---|---|---|
| `storageFull` | 507 | An upload or a large write, such as an import, while the file store is at the matching level. `refusal` is `upload` or `largeWrite`. |
| `notEnoughStorage` | 507 | A new export, which also counts the estimated size of waiting exports. |

Editing pages keeps working at every level.
