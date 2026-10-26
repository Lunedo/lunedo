# Storage warnings

Lunedo warns the instance administrators before the file store is full and refuses writes that would fill it. Only the file store is measured: attachments, import uploads and finished exports. The database is not.

## Measuring

- **Local volume:** the usage is read from the volume with `statfs`: used bytes divided by the size of the volume. It is read before every upload, import and export, and once a minute for the warnings.
- **S3-compatible storage:** S3 does not report free space. Set a limit in the storage settings (for example 500 GB). Lunedo keeps a running total of the bytes it stores, adjusted on every write and delete, and compares it with the real sum once a day. Without a limit there is no warning and no refusal, and the settings say so.

## Levels

| Level | Default | Effect |
|---|---|---|
| Warning | 80 % | Administrators and operations contacts are told. Nothing is blocked. |
| Large writes paused | 90 % | New space and subtree exports and imports are refused. |
| Critical | 95 % | Uploads are refused too. Editing pages keeps working. A running export stops cleanly and leaves no file. |

The three levels are instance settings and must rise from one to the next. A new export also counts the estimated size of waiting exports.

## Notifications

- Recipients: all instance administrators, and the **operations contacts**: e-mail addresses (for example an IT ticket address) and one optional Microsoft Teams Workflows webhook. The webhook address is stored encrypted and never returned.
- A banner shows in the settings for as long as a level is active and links to the storage section.
- A level becomes active after two checks in a row, one minute apart, at or above its threshold. It clears when the usage falls 5 percentage points below the threshold (warning at 80 %, cleared below 75 %). Readings that move around a threshold therefore notify once.
- A notification goes out when a level becomes active or a higher one does. When the usage falls below a level, one short message says what works again.
- While a level stays active, the **reminder** repeats the current state: never, daily, weekly (default) or monthly.
- The e-mails are operations mails: no unsubscribe link, and a footer that says why the recipient gets them. Every e-mail links to the storage section.
- The Teams post is queued with the level change and sent by the chat delivery job, which retries a failing post. The test message is posted at once.
- An import that fails because the storage is full ends as failed with the code `storageFull`, and its report says "Storage full". A running import is not stopped when the critical level is reached.

## Interface

The section **Settings > Instance > Storage** shows the usage, the three levels (saved together), the S3 limit and the reminder. The operations contacts and the button to send a test message to them are under **Settings > Instance > Notifications**, because backup warnings use them too. Changing the operations contacts is audited as `storage.contactsChanged`.

The API is `GET` and `PUT /api/v1/instance/storage` and `POST /api/v1/instance/storage/test`. Refused uploads and imports answer `507` with the problem `storageFull`; refused exports keep `notEnoughStorage`.
