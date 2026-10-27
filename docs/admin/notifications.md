# Notifications

Lunedo notifies people in the app, by e-mail and, when it is turned on, by browser push. The notification center in the app always works, also without a mail server. This page covers what administrators set: the defaults of an organization, the daily digest, how long notifications are kept, browser push and the operations contacts. How people choose for themselves and watch content is described in [Notifications](../user/notifications.md); the endpoints are in [Notifications API](../api/notifications.md).

## Organization defaults

Every event has one setting per channel:

| Setting | Values |
|---|---|
| `notifications.<event>.inApp` | On or off |
| `notifications.<event>.email` | **Off**, **Immediately** or **In the daily digest** |
| `notifications.<event>.push` | On or off |

These settings exist at the organization and the user level. Each channel inherits on its own, so a person who changes the e-mail choice of an event keeps following the organization's default for the app.

To change the defaults:

1. Open **Settings › Organization › Notifications**. The page needs the organization area Settings; changing it needs Settings with Manage.
2. Under **Events**, set the channels of the content events. The events of administration and security are under **Administration and security**, collapsed.
3. Each change saves at once. A channel that differs from the inherited value shows a reset.

People who chose for themselves keep their choice when you change a default. Events about the instance, such as backups or a new Lunedo version, follow the defaults of the recipient's home organization.

### Content events

| Event | Setting | E-mail default | Push default |
|---|---|---|---|
| Mentions of me | `mentions` | Immediately | On |
| Tasks assigned to me | `tasks` | Immediately | On |
| Pages shared with me and answers to my access requests | `shares` | Immediately | On |
| Access requests I can decide | `accessRequests` | Immediately | On |
| Comments and replies on content I watch | `comments` | In the daily digest | Off |
| Changes to content I watch | `changes` | Off | Off |
| Copies I made | `copies` | Off | Off |
| New posts in blogs I follow | `blogPosts` | In the daily digest | Off |
| Meeting reminders and notes | `meetings` | Off | Off |
| Article reviews | `reviews` | In the daily digest | Off |
| Ownership and page status changes | `ownershipAndStatus` | Off | Off |

Every event is on in the app by default. Mentions, tasks, shares and access requests still arrive when a person mutes the item or space, unless they chose otherwise when muting.

### Administration and security events

| Event | Setting | E-mail default |
|---|---|---|
| Space administration | `spaceAdministration` | Off |
| Imports and exports | `importsAndExports` | Off |
| API token expires soon | `apiTokenExpiring` | Immediately |
| API token unused | `apiTokenUnused` | Immediately |
| Guest access ends soon | `guestExpiring` | Immediately |
| Guest is inactive | `guestInactive` | Immediately |
| Role or membership ends soon | `accessExpiring` | Immediately |
| Service account without responsible person | `serviceAccountUnattended` | Immediately |
| Break-glass access started | `breakGlassStarted` | Immediately |
| Emergency sign-in used | `authEmergencySignIn` | Immediately |
| Administrative roles paused | `accountRolesWithheld` | Immediately |
| New account without organization | `accountWithoutOrganization` | Immediately |
| Home organization changed | `accountHomeOrganizationChanged` | Immediately |
| E-mail credential expires soon | `mailCredentialExpiring` | Immediately |
| File store fills up | `storageLevelReached` | Immediately |
| File store usage falls | `storageLevelCleared` | Immediately |
| New Lunedo version | `operationsUpdateAvailable` | Immediately |
| A backup fails | `backupFailed` | Immediately |
| No recent backup | `backupMissing` | Immediately |
| Backups work again | `backupRecovered` | Immediately |
| A test restore fails | `backupTestRestoreFailed` | Immediately |
| Provider credential expires soon | `identityProviderCredentialExpiring` | Immediately |
| Synchronization stopped before deactivating accounts | `identityProviderSyncHeld` | Immediately |
| An administrator became space admin of my space | `spaceAdministratorTaken` | Immediately |
| Sign-in from a new browser | `signInNewBrowser` | Immediately |

These events are on in the app and off for push by default.

### Locking a default

A locked default applies to every member, and people can no longer change it; their notification settings show "Locked by" and the organization's name. The page does not offer locking. Lock a channel through the API with the setting key and `{ "locked": true }`:

```http
PUT /api/v1/organizations/{organizationId}/settings/notifications.mentions.email
Content-Type: application/json

{ "value": "immediately", "locked": true }
```

`{ "locked": false }` unlocks it again. The call needs the organization area Settings with Manage. See [Organizations API](../api/organizations.md).

## Daily digest

The digest collects the notifications whose e-mail is set to **In the daily digest** in one mail per person, grouped by space and item, newest first. It is sent only when something is left after the checks at sending time.

| Setting | Key | Default |
|---|---|---|
| Send a daily summary by e-mail | `notifications.digestEnabled` | On |
| Send the digest at | `notifications.digestTime` | 08:00, in each person's own time zone |

Both are under **Settings › Organization › Notifications**, section **Delivery**, and each person can change them. They cannot be locked. With the digest off, digest notifications stay in the app only.

## E-mail

A notification goes out by e-mail when, at the event, the person chose **Immediately** or **In the daily digest**, the account has an address and a mail server is set up, see [E-mail](email.md). Everything else is checked again when the mail is built: the preference at that moment, an active account with an address, an active membership in the organization of the notification, and whether the person can still see what it is about. A notification the person can no longer see, has read in the app or no longer wants by e-mail is left out. Titles are read again at that moment, and mails contain short excerpts only of what the person can read then.

When mails go out:

- **Mentions, tasks, shares and access requests:** after 2 minutes, so several events about the same item in that time become one mail.
- **Other content events**, such as changes and comments: once nothing new was combined into the notification for 30 minutes, or 24 hours after it started. A burst of changes becomes one mail, as it becomes one notification.
- **Administration and security events:** at once.
- **Daily digest:** at the digest time.

Each notification mail links to the notification and to the notification settings. It carries an unsubscribe link in the footer and the one-click unsubscribe headers `List-Unsubscribe` and `List-Unsubscribe-Post` (RFC 8058). Microsoft Graph with its default setting sends no headers, see [Microsoft 365](email/microsoft-365.md#sent-items-and-unsubscribe-headers). The link works without signing in and does not expire. It sets the e-mail choice of that one event to **Off**, or turns the digest off, for that person only. A value the organization locked is not changed; the page says so.

Security and operations events, such as a new browser, break-glass access, expiring credentials or backups, carry no unsubscribe link.

## Retention

| Setting | Key | Default | Range |
|---|---|---|---|
| Retention of notifications | `notifications.retentionDays` | 90 days | 1 to 3650 days |

The instance value is under **Settings › Instance › People and sign-in › Policies**, section **Retention**, and can be locked for organizations. Organizations set their own under **Settings › Organization › Notifications**, section **Delivery**. A daily job removes notifications whose last change is older; notifications about the instance follow the instance value.

## Browser push

Browser push is off until an instance administrator turns it on:

1. Open **Settings › Instance › Services › Delivery**.
2. Turn on **Browser push for this instance** and confirm with **Turn on browser push**.

Messages then go through the push services of the browser makers, such as Google, Mozilla, Apple and Microsoft, and leave the instance. Their content is encrypted with Web Push encryption (RFC 8291) and signed with VAPID (RFC 8292); the push services only see when a message goes to which browser. Nothing is sent until people turn push on for their own devices, and the browser asks for permission only then. A person can register up to 20 devices.

The payload holds the event text, the item title and a link, nothing else. Before sending, Lunedo checks that the account is active, push is still on and the person can still read the item. Push is on by default for mentions, tasks, shares and access requests. The organization's notification page shows whether push is on for the instance.

## Operations contacts

Besides all instance administrators, operations contacts receive warnings about the instance by e-mail and optionally as a Teams post: the file store fills up or falls again, and backups fail, are missing, work again or a test restore fails. Set them under **Settings › Instance › Services › Delivery**, section **Operations contacts**:

1. Under **E-mail addresses**, enter one address per line, up to 20, for example an IT ticket address.
2. Under **Teams webhook**, optionally paste the address of a Teams Workflows webhook. It is stored encrypted and never shown again.
3. Save, then select **Send test message**.

Operations contacts need no account. The warnings for instance administrators follow their notification settings; see [Storage](storage.md) and [Backups](backups.md) for what triggers them.
