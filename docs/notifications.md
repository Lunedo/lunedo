# Notifications

The notification center is the core channel: it always works, also without a mail server. E-mail is a second channel of the same core.

## Event types

| Type | Recipients | Target |
|---|---|---|
| `apiToken.expiring` | Owner of a personal token; responsible people of a service account | The token |
| `apiToken.unused` | Owner of a personal token; responsible people of a service account, otherwise owners of its organization | The token |
| `guest.expiring` | The guest's responsible person, otherwise owners and administrators | The guest's account |
| `guest.inactive` | As above | The guest's account |
| `access.expiring` | Who granted the role or membership, a manager of the group, otherwise owners and administrators | The role assignment, group or membership |
| `serviceAccount.unattended` | Owners of the organization | The service account |
| `breakGlass.started` | Owners of the organization | The break-glass access |
| `signIn.newBrowser` | The account itself | The account |

Event types register in the `NotificationRegistry` with a parameter schema, a visibility rule, the mail they render and their preference setting, so later features add their own without changing the core. Their parameters are defined in `@pagehall/shared`, so that the web client renders them with the same types.

Mails for password resets, e-mail changes, recovery codes, invitations, registrations and test mails remain direct mails: they are part of a flow the person started and do not depend on preferences.

A sign-in from a browser whose device cookie the account has not used before creates `signIn.newBrowser`. The first browser of an account and sign-ins without a device cookie do not.

## Storing and combining

`NotificationService.notify` runs inside the transaction of the change that causes the notification, so a notification exists exactly when the change is committed. A reminder is marked as sent in the same transaction; a crash in between sends it on the next run.

Events of the same type on the same target for the same recipient within 15 minutes are combined into one unread notification with a count. An advisory lock per recipient and target makes concurrent events on several nodes end in one notification.

Deactivated accounts receive nothing. Service accounts never receive notifications.

## Visibility

Permissions are checked whenever notifications are listed or counted, through the authorization service. A notification whose target the recipient can no longer see is hidden, for example a guest notice after the recipient lost the members area of that organization, unless they are still the guest's responsible person.

## Preferences

Every event type has the setting `notifications.<type>`, for example `notifications.guestExpiring`, with the value `{ "inApp": true, "email": true }`. It applies at instance, organization and user level and can be locked, so users choose their channels in their preferences and organizations can set defaults. E-mail is sent only when the channel is on, the account has an address and a mail server is configured.

`notifications.retentionDays` (instance, default 90) sets how long notifications are kept. A daily job removes older ones.

## Live updates

A committed notification sends a PostgreSQL notification on the channel `pagehall_notifications` with the recipient's account ID. Every API node listens on one connection and forwards it to the streams of that account, so a client receives it from any node. After the listening connection was lost, every stream gets an update, because events may have been missed.

## Endpoints

All endpoints are internal and need a signed-in session.

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/notifications?cursor=&limit=&unread=true` | Own notifications, most recently changed first |
| `GET /api/v1/notifications/unread-count` | Unread notifications the caller may see |
| `POST /api/v1/notifications/{notificationId}/read` | Mark one as read |
| `POST /api/v1/notifications/read-all` | Mark all as read, optionally only those changed before `before` |
| `GET /api/v1/notifications/stream` | Server-sent events: `notifications` with `{ "unreadCount": n }` at the start and after every change, a comment every 25 seconds; the stream ends when the session ends |
