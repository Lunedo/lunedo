# Notifications

This page explains how notifications work inside the server. What administrators set is described in [Notifications](../admin/notifications.md), what people choose in [Notifications](../user/notifications.md), the endpoints in [Notifications API](../api/notifications.md).

## Types and events

A notification type is a string such as `content.changed` or `backup.failed`. Its parameter schema lives in `@lunedo/shared` (`packages/shared/src/notifications.ts`): `notificationParamSchemas` for administration types and `contentNotificationParamSchemas` for content types. The web client renders notifications with the same types.

Each type registers in the `NotificationRegistry` (`packages/server/src/notifications/registry.ts`) with `defineNotificationType`:

| Field | Purpose |
|---|---|
| `params` | The parameter schema; `notify` parses the parameters with it. |
| `targetType` | What the target ID points to, such as an item or a token. |
| `visible` | Whether a recipient may still see the notification; checked when it is created, listed, counted, mailed and pushed. |
| `mail` | The mail template and its parameters, for types that send mail. |
| `subject` | For types that are not about an item: the space or item they come from, used for muting. |

New features register their own types without changing the core. A type registered twice fails at startup.

Every type belongs to exactly one event of `notificationEvents`. Preferences, muting and the delivery of every channel route through that list. Content events (`mentions`, `tasks`, `shares`, `accessRequests`, `comments`, `changes`, `copies`, `blogPosts`, `meetings`, `reviews`, `ownershipAndStatus`) group several types each. Administration events are `spaceAdministration`, `importsAndExports` and one event per administration type, named after the type by `notificationSettingKey` (for example `apiToken.expiring` becomes `apiTokenExpiring`). An event's `keptWhenMuted` decides whether it passes a mute with `keepActionable`; `security` marks events whose mails carry no unsubscribe link. `notify` throws for a type that belongs to no event.

The preference settings are defined in `packages/server/src/notifications/types.ts`: three per event (`inApp`, `email`, `push`) at the organization and user level, all lockable, plus `notifications.retentionDays` (instance and organization), `notifications.digestTime` and `notifications.digestEnabled` (organization and user, not lockable), `notifications.watchAutomatically` (user) and `notifications.browserPush` (instance). A new channel adds its own settings and needs no migration of stored values.

## Storing and combining

`NotificationService.notify` runs inside the transaction of the change that causes the notification, so a notification exists exactly when the change is committed. A reminder is marked as sent in the same transaction; a crash in between sends it on the next run.

Events of the same type on the same target for the same recipient are combined into one unread notification while the last event is less than 30 minutes old (`COMBINE_WINDOW_MINUTES`), for at most 24 hours (`COMBINE_MAX_HOURS`). The notification keeps a count and up to 50 people who took part, so it reads "Gaby and 2 others changed …, 7 changes". Thirty minutes cover the pauses within one working session on a page; the 24-hour limit starts a new notification for a page that is edited all day. A read notification is never changed again. A transaction-level advisory lock per recipient and target makes concurrent events on several nodes end in one notification.

Content events skip a recipient who is the only person behind the event, so people are not notified about their own actions. Recipients whose account is not active receive nothing. Recipients who muted the item, its meeting series or its space are skipped, unless the event is kept when muted and the mute keeps actionable events.

Events about the instance (`organizationId` null) read the preferences through the recipient's home organization.

## E-mail

`notify` decides per recipient whether the notification is marked for e-mail: the e-mail preference is not `off`, the account has an address and a mail method is configured. Administration events with `immediately` are queued as a mail at once, in the same transaction, unless they were combined into an existing notification.

All other mails come from the job `notifications.send-emails` (`packages/server/src/notifications/email.ts`), which runs every minute:

- **Immediate content mails.** Actionable types (those of events kept when muted) are sent once they are 2 minutes old (`ACTIONABLE_MAIL_DELAY_MINUTES`); other content types once nothing was combined into them for the combining window, or 24 hours after they started. The job locks the rows it sends (`for update skip locked`) and writes the mail to the outbox and the notification as `sent` in one transaction, so two nodes and a restart never send a notification twice.
- **Digests.** Per person, every notification marked for the digest since before the last digest time in the person's time zone, at most 200, in one mail, grouped by space and item. A transaction-level advisory lock per person keeps two nodes from sending two digests.

Before a mail is built, everything is checked again: the preference at that moment, an active account with an address, an active membership in the organization of the notification, and the type's visibility rule. A notification that fails a check is marked `skipped`; one whose preference changed between immediately and digest moves to the other.

The unsubscribe link (`packages/server/src/notifications/unsubscribe.ts`) holds the account ID, the event or `digest`, and an HMAC with the instance's signing key. Events marked `security` get no link, and a token naming such an event is rejected.

## Browser push

A new notification for which the person chose push is written to `push_outbox` in the same transaction, unless it was combined into an existing one. A worker sends it after commit and checks first that the account is active, push is still on and the person can still read the item. Push services that are busy or unreachable are retried with backoff; a subscription is deleted when the push service answers that it is gone. The VAPID key pair is created once per instance on first use, under a transaction-level advisory lock, and stored encrypted in `instance_secrets`. An account can have at most 20 push devices (`tooManyDevices`).

## Chat channels

Chat deliveries are rows in `chat_deliveries`, written in the transaction of the event (`packages/server/src/chat/channels.ts`). Page changes and decisions use a combine key and a `not_before` time, so changes of one page within an hour, and a decision five minutes after it appears, become one delivery. The worker sends them with up to five retries and backoff (`chat.deliver` in `packages/server/src/chat/jobs.ts`); a watchdog every ten minutes queues deliveries that were never started. A permanent failure, or the last attempt, marks the channel `failing` and notifies its administrators once. Finished deliveries are deleted after 14 days.

## Live updates

A committed notification sends a PostgreSQL notification on the channel `lunedo_notifications` with the recipient's account ID. Every API node listens on one connection (`NotificationHub` in `packages/server/src/notifications/hub.ts`) and forwards it to the streams of that account, so a client receives it from any node. After the listening connection was lost and reconnected, every stream gets an update, because events may have been missed.

A setting change reaches every node through PostgreSQL notifications as well. A node sends `settings` to a connection when the change is at the user level of its account, at the instance level, or at the level of an organization the account belongs to, unless a lower level of the account (its home organization or the account itself) overrides the value and the changed level does not lock it. Locking and unlocking always count, and so does a new value of a locked setting, because it applies regardless of lower levels. Clients reload the named setting.
