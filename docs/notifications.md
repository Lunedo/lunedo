# Notifications

The notification center is the core channel: it always works, also without a mail server. E-mail is a second channel of the same core.

## Event types

| Type | Recipients | Target |
|---|---|---|
| `apiToken.expiring` | Owner of a personal token; responsible people of a service account, otherwise owners of its organization | The token |
| `apiToken.unused` | Owner of a personal token; responsible people of a service account, otherwise owners of its organization | The token |
| `guest.expiring` | The guest's responsible person, otherwise owners and administrators | The guest's account |
| `guest.inactive` | As above | The guest's account |
| `access.expiring` | Who granted the role or membership, a manager of the group, otherwise owners and administrators | The role assignment, group or membership |
| `serviceAccount.unattended` | Owners of the organization | The service account |
| `breakGlass.started` | Owners of the organization | The break-glass access |
| `signIn.newBrowser` | The account itself | The account |
| `auth.emergencySignIn` | Instance owner and instance administrators | The owner account |
| `identityProvider.credentialExpiring` | Instance owner for instance providers, owners of the organization for organization providers | The identity provider |
| `identityProvider.syncHeld` | Instance owner and instance administrators | The identity provider |

Content events reach people who watch the content, see [Watching](#watching): `content.changed` (a new version, published or saved at the end of a live editing session), `comment.created` (a comment or reply), `page.statusChanged` and `ownership.transferred` (also to the new owner). Mentions, assigned tasks, shares and access requests reach the person concerned.

Event types register in the `NotificationRegistry` with a parameter schema, a visibility rule, the mail they render and, for types not about a page, the space or item they come from, so later features add their own without changing the core.

Every type belongs to exactly one event of `notificationEvents` in `@pagehall/shared`. Preferences, muting and the delivery of every channel route through that list: `mentions`, `tasks`, `shares`, `accessRequests`, `comments`, `changes`, `blogPosts`, `meetings` and `ownershipAndStatus` for content, `spaceAdministration`, `importsAndExports` and one event per administration type such as `apiTokenExpiring`. Their parameters are defined in `@pagehall/shared`, so that the web client renders them with the same types.

Mails for password resets, e-mail changes, recovery codes, invitations, registrations and test mails remain direct mails: they are part of a flow the person started and do not depend on preferences.

A sign-in from a browser whose device cookie the account has not used before creates `signIn.newBrowser`. The first browser of an account and sign-ins without a device cookie do not.

## Storing and combining

`NotificationService.notify` runs inside the transaction of the change that causes the notification, so a notification exists exactly when the change is committed. A reminder is marked as sent in the same transaction; a crash in between sends it on the next run.

Events of the same type on the same target for the same recipient are combined into one unread notification while the last event is less than 30 minutes old, for at most 24 hours. The notification keeps a count and the people who took part, so it reads "Gaby and 2 others changed …, 7 changes". Thirty minutes cover the pauses within one working session on a page; the 24-hour limit starts a new notification for a page that is edited all day. A read notification is never changed again. An advisory lock per recipient and target makes concurrent events on several nodes end in one notification.

People are never notified about their own actions: content events skip a recipient who is the only person behind the event. Imports never notify and do not make anyone watch.

Deactivated accounts receive nothing. Service accounts never receive notifications.

## Visibility

Permissions are checked when notifications are created and whenever they are listed or counted, through the authorization service. A notification whose target the recipient can no longer see is hidden, for example a guest notice after the recipient lost the members area of that organization, unless they are still the guest's responsible person.

## Preferences

Every event has one setting per channel: `notifications.<event>.inApp` (true or false), `notifications.<event>.email` (`off`, `immediately` or `digest`) and `notifications.<event>.push` (true or false). They apply at instance, organization and user level and can be locked. Each channel inherits on its own, so a person who changes the e-mail choice keeps following the organization's default for the app. A new channel adds its own settings and needs no migration of stored values.

Shipped defaults: every event in the app; e-mail immediately for mentions, tasks, shares and access requests; comments and new blog posts in the daily digest; everything else in the app only. Administration events keep e-mail on.

`notifications.digestTime` (default 08:00 in the person's time zone) and `notifications.digestEnabled` (default on) apply at instance, organization and user level. Without an app channel, a notification is still stored for e-mail but never shown in the app (`in_app` is false).

## E-mail

A notification is marked for e-mail when, at the event, the person chose `immediately` or `digest`, the account has an address and a mail server (SMTP or Microsoft Graph) is configured. Everything else is decided again when the mail is built: the preference at that moment, an active account with an address, an active membership in the organization of the notification, and the visibility rule of the type. A notification the person can no longer see, has read in the app or no longer wants by e-mail is left out and marked `skipped`; one whose preference changed between immediately and the digest moves to the other. Titles are read again at that moment, and mails contain short excerpts only of what the person can read then: the task text, the message of an access request and the text of a comment the person may view.

- Immediately, content events: the job `notifications.send-emails` runs every minute and sends a notification once nothing was combined into it for the 30 minutes of the combining window, or 24 hours after it started. A burst of changes therefore becomes one mail, as it becomes one notification. The job locks the rows it sends (`for update skip locked`) and writes the mail to the outbox and the notification as `sent` in one transaction, so two nodes and a restart never send a notification twice.
- Immediately, administration events (such as a new browser, emergency sign-in or break-glass access) are sent at once, as before, because they are not bursts and are urgent.
- Daily digest: the same job sends, per person, every notification marked for the digest since before the last digest time in the person's time zone, in one mail, and only when something is left after the checks. Entries are grouped by space and by item, newest first. A per-person advisory lock keeps two nodes from sending two digests. With `notifications.digestEnabled` off, digest notifications stay in the app only.

Each mail links to the notification (`/notifications/{id}` in the web client, which marks it as read and opens what it is about) and to the notification settings. It carries `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058) and an unsubscribe link in the footer. The link holds the account ID, the event (or `digest`) and an HMAC with the instance's signing key; it works without signing in, does not expire and only sets the e-mail preference of that event to `off`, or `notifications.digestEnabled` to false, for that account. `POST /api/v1/notifications/unsubscribe/{token}` is the one-click target and is exempt from the request header check; `GET` on the same path says what the link turns off, and the page `/unsubscribe/{token}` asks before turning it off. A value the organization locked is not changed; the page says so.

`notifications.retentionDays` (instance, default 90, overridable per organization) sets how long notifications are kept. A daily job removes older ones.

## Browser push

Browser push is off until an instance administrator turns on `notifications.browserPush`. Messages then go through the push services of browser makers; their content is encrypted with Web Push encryption (RFC 8291) and signed with VAPID (RFC 8292), but they leave the instance. The VAPID key pair is created once per instance on first use and stored encrypted in `instance_secrets`.

People turn push on per device. The browser asks for permission only then. The subscription belongs to the session it was created in: signing out, ending the session or its expiry deletes it, and so does a push service that answers 404 or 410. Push is on by default for mentions, tasks, shares and access requests.

A new notification for which the person chose push is written to `push_outbox` in the same transaction. A worker sends it after commit and checks first that the account is active, push is still on and the person can still read the item. The payload holds the event text, the item title and a link, nothing else. A notification that is combined into an existing one in the app is not pushed again. Push services that are busy or unreachable are retried with backoff; the browser replaces repeated messages with the same tag.

## Chat channels

Space administrators connect a space to Microsoft Teams (a Workflows webhook with an Adaptive Card), Slack and Discord webhooks, a Matrix room (homeserver, room ID and the access token of a bot) or a generic webhook. Organization administrators with the integrations area connect channels for the organization announcement. Addresses, tokens and the signing secret of generic webhooks are stored encrypted and are never returned; the signing secret is shown once after saving. Generic webhooks get a JSON body with the headers `X-Pagehall-Event`, `X-Pagehall-Delivery`, `X-Pagehall-Timestamp` and `X-Pagehall-Signature` (`sha256=` and the HMAC-SHA256 of the timestamp, a dot and the body).

Events: `pagePublished` (first version of a page), `pageChanged` (later versions, combined per page for one hour), `blogPostPublished`, `decisionRecorded` (sent five minutes after the decision appears, with its text at that time), `pageStatusChanged`, `commentCreated` and, for organizations, `announcementPublished` (sent when the announcement starts).

Only content every member of the space can read is posted: the item is published, not in the trash or archived, and neither it nor a page above it has a view restriction. Comments on such pages are posted unless they belong to a hidden inline comment. Confidential and personal spaces cannot have chat channels. The check runs when the event happens and again when the message is sent.

Requests go to public addresses only. Private, loopback and link-local addresses are refused unless they are in `PAGEHALL_OUTBOUND_ALLOWED_NETWORKS`; the address is checked for every connection, so redirects and changed DNS answers cannot reach other networks. Redirects keep the Matrix token only on the same origin.

Deliveries are stored in `chat_deliveries` and sent by the worker with up to five retries and backoff. A channel whose service keeps failing, or answers that the address is gone or not allowed, is marked failing with the reason, its administrators are notified once, and nothing more is posted until a test message succeeds or the address is changed. Finished deliveries are deleted after 14 days.

## Watching

People watch pages, blog posts, meeting series and spaces. A watch row holds one of three states for one item or space: `watching`, `muted` (with `keepMentions`, true by default) or `notWatching`. People who create, edit or comment on an item watch it automatically unless `notifications.watchAutomatically` is off for them or they chose a state for it before.

The state that applies to an item comes from the item, then its meeting series, then its space; the most specific row wins, except that an automatic watch never overrides a mute further up. Muting silences every event about the item or space; mentions, assigned tasks, shares with the person and access requests they can decide still arrive when `keepMentions` is true, which is the default.

Watching never grants anything. Delivery checks that the watcher can read the item; while they cannot, nothing arrives and the watch stays, so delivery resumes when access returns.

## Live updates

A committed notification sends a PostgreSQL notification on the channel `pagehall_notifications` with the recipient's account ID. Every API node listens on one connection and forwards it to the streams of that account, so a client receives it from any node. After the listening connection was lost, every stream gets an update, because events may have been missed.

## Endpoints

These endpoints are internal and need a signed-in session, except the unsubscribe endpoints. Chat channels are part of the public API under `/api/v1/spaces/{spaceId}/chat-channels` (space administrators) and `/api/v1/organizations/{organizationId}/chat-channels` (integrations area). Watching is part of the public API: `GET`, `PUT` and `DELETE` on `/api/v1/items/{itemId}/watch` and `/api/v1/spaces/{spaceId}/watch` need read access to the item or space.

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/notifications?cursor=&limit=&unread=true` | Own notifications, most recently changed first |
| `GET /api/v1/notifications/unread-count` | Unread notifications the caller may see |
| `GET /api/v1/notifications/{notificationId}` | One own notification the caller may still see |
| `GET`, `POST /api/v1/notifications/unsubscribe/{token}` | Public: show or apply an unsubscribe link |
| `POST /api/v1/notifications/{notificationId}/read` | Mark one as read |
| `POST /api/v1/notifications/read-all` | Mark all as read, optionally only those changed before `before` |
| `GET /api/v1/account/watches` | Own watched and muted items the caller can still open, with counts |
| `GET /api/v1/account/notification-delivery` | Whether e-mail can be delivered and how, and whether browser push is on |
| `GET /api/v1/account/push` | Whether browser push is on, the public key and the caller's devices |
| `POST /api/v1/account/push/devices` | Turn push on for the device of the current session |
| `DELETE /api/v1/account/push/devices/{deviceId}` | Turn push off for a device |
| `GET /api/v1/notifications/stream` | Server-sent events: `notifications` with `{ "unreadCount": n }` at the start and after every change; `settings` with `{ "key", "level", "organizationId" }` when a setting changes whose value may change for the caller; a comment every 25 seconds; the stream ends when the session ends |

A setting change reaches every node through PostgreSQL notifications. A node sends `settings` to a connection when the change is at the user level of its account, at the instance level, or at the level of an organization the account belongs to, unless a lower level of the account (its home organization or the account itself) overrides the value and the changed level does not lock it. Locking and unlocking always count, and so does a new value of a locked setting, because it applies regardless of lower levels. Clients reload the named setting.
