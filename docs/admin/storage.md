# File storage

Lunedo keeps attachments and other stored files in its file store: a local directory or a bucket in S3-compatible object storage. Files are encrypted in both cases (see [Encryption](encryption.md)). This page explains how to choose the file storage, how Lunedo warns before the file store is full, and who receives these warnings.

## Where files are stored

The file storage is chosen through configuration; it has no setting in the interface. See [Configuration](configuration.md) for how settings are given.

### Local directory

By default (`LUNEDO_FILE_STORAGE=local`) files are stored below `LUNEDO_FILES_DIR`, by default `/var/lib/lunedo/files`. In the Compose file of the setup script this directory is part of the `lunedo-data` volume.

### S3-compatible storage

With `LUNEDO_FILE_STORAGE=s3`, attachments are stored as objects named `<prefix>attachments/<key>` in a bucket. Set the S3 settings on every node.

`LUNEDO_S3_BUCKET` is required; the endpoint, region, access keys, path style and prefix are optional. [File storage and imports](environment-variables.md#file-storage-and-imports) lists each of them with its default and allowed values. The access keys are secrets and can also be given as a file, for example `LUNEDO_S3_SECRET_ACCESS_KEY_FILE=/run/secrets/s3-secret`.

The bucket for files and the target for backups are separate. Backups of an instance with S3 file storage contain the objects of the bucket, and a restore writes them back to the configured bucket (see [Backups](backups.md#content)).

## Storage warnings

Lunedo warns the instance administrators before the file store is full, and refuses writes that would fill it. Only the file store is measured, not the database.

### Measuring

- **Local directory:** Lunedo reads the used and total size of the volume that holds the file store. It reads them before every upload, import and export, and once a minute for the warnings.
- **S3-compatible storage:** S3 does not report free space. Set a limit on the storage page (for example 500 GiB). Lunedo keeps a running total of the bytes it stores, adjusted on every write and delete, and compares it with the real sum of the objects once a day at 03:23 UTC. Without a limit there is no warning and no refusal, and the storage page says so.

### Levels

| Level | Default | Effect |
|---|---|---|
| Warning | 80 % | Administrators and operations contacts are told. Nothing is blocked. |
| Large writes paused | 90 % | New space and subtree exports and new imports are refused. |
| Critical | 95 % | Uploads are refused too. Editing pages keeps working. A running export stops cleanly and leaves no file. |

The levels are whole percentages from 1 to 100 and must rise from one to the next. A new export also counts the estimated size of the exports that are still waiting.

A refused upload or import answers with status `507` and the problem `storageFull`; a refused export answers with `notEnoughStorage`. An import that fails because the storage is full ends as failed with the code `storageFull`, and its report says "Storage full". A running import is not stopped when the critical level is reached.

Backups use the critical level as well: a backup or test restore that would take a disk above it is refused before it starts (see [Backups](backups.md#free-space-before-a-backup)).

### When a level becomes active

- A level becomes active after two checks in a row, one minute apart, at or above its threshold.
- It clears when the usage falls 5 percentage points below the threshold (a warning at 80 % clears below 75 %). Readings that move around a threshold therefore notify only once.
- A notification goes out when a level becomes active or a higher one does. When the usage falls below a level, one short message says what works again.
- While a level stays active, the reminder repeats the current state: never, daily, weekly (default) or monthly.
- A banner shows in the settings for as long as a level is active and links to the storage page.

### Notifications

- Instance administrators receive the warnings in the notification center, by e-mail and by push, as their notification preferences say.
- The operations contacts receive them by e-mail and, when a Teams webhook is set, as a Teams post.
- The e-mails are operations mails: they have no unsubscribe link, their footer says that the recipient gets them as an instance administrator or operations contact, and they link to the storage page.
- The Teams post is queued with the level change and sent by the chat delivery job, which retries a failing post.

### Storage page

**Settings › Instance › Operations › Storage** shows:

| Section | Content |
|---|---|
| **Usage** | The file store (**Local volume** or **S3-compatible storage**), the used and total size, the status (**Normal**, **Warning**, **Large writes paused**, **Critical**) and when it was checked. |
| **Warning levels** | **Warning**, **Large writes paused** and **Critical**, saved together. |
| **S3 limit** | Only with S3 file storage. **Limit for stored files** in GiB (the field is labeled GB and counts 1024³ bytes), or empty for no warning. |
| **Reminders** | **Reminder while a level is active**: **Never**, **Daily**, **Weekly** or **Monthly**. The backup warnings use the same reminder. |

Viewing the page needs the permission to view instance settings; changing it needs the permission to manage them (see [Roles and permissions](roles-and-permissions.md)). The API is described in [Storage API](../api/storage.md). The system status shows the storage level as well (see [System status](monitoring/system-status.md#storage)).

## Operations contacts

Besides all instance administrators, the operations contacts receive operations warnings: storage warnings and backup warnings (see [Backups](backups.md#warnings)). Set them under **Settings › Instance › Services › Delivery**, section **Operations contacts**:

| Field | Content |
|---|---|
| **E-mail addresses** | One address per line, up to 20, for example an IT ticket address. |
| **Teams webhook** | The address of one Microsoft Teams Workflows webhook. It is stored encrypted and never shown again; the page shows only its host, with **Replace webhook** and **Remove webhook**. |

**Send test message** sends a test message to every saved address and posts one to the webhook at once, and says whether Teams accepted it. Changes of the operations contacts are recorded in the [audit log](audit-log.md).
