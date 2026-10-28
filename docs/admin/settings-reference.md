# Settings reference

This page is generated from `packages/server/src/settings/catalog.ts`, `apps/web/src/settings/settings-index.ts`, `apps/web/src/shell/settings-pages.ts`, `apps/web/src/i18n/locales/en.json` by `pnpm docs:generate`. Do not edit it by hand; change the code and run the command again.

Every setting stored in the database, grouped as in the settings navigation, with its English label and hint. **Levels** names where it can be set: a value set at a level applies to the levels below it unless they set their own. **Allowed values** comes from the schema the server checks values against. **Lockable** settings can be locked at a level so that the levels below cannot change them.

## My account › Preferences

### Display

| Key | Label | Levels | Default | Allowed values | Lockable | Hint |
|---|---|---|---|---|---|---|
| `appearance.colorMode` | Color mode | user | `system` | `system`, `light` or `dark`. | no | “Automatic” follows your system. |
| `appearance.highContrast` | High contrast | user | `false` | `true` or `false`. | no | Stronger colors and borders. |
| `appearance.textSize` | Text size | user | `1` | `0.875`, `0.9375`, `1`, `1.125` or `1.25`. | no | Scales text, spacing and icons together. |
| `appearance.density` | Density | user | `default` | `default` or `compact`. | no | “Compact” shows more entries. |
| `appearance.font` | Reading-friendly font | user | `default` | `default` or `readable`. | no | Designed for low vision. |

### Language and region

| Key | Label | Levels | Default | Allowed values | Lockable | Hint |
|---|---|---|---|---|---|---|
| `locale.language` | Language | instance, organization, user | `en` | `en` or `de`. | yes |  |
| `locale.timeZone` | Time zone | instance, organization, user | `UTC` | An IANA time zone, for example `Europe/Vienna`. | yes |  |
| `locale.dateFormat` | Date format | organization, user | `D MMM YYYY` | `D MMM YYYY`, `DD.MM.YYYY`, `DD/MM/YYYY`, `MM/DD/YYYY` or `YYYY-MM-DD`. | no |  |
| `locale.timeFormat` | Time format | organization, user | `12h` | `24h` or `12h`. | no |  |
| `locale.numberFormat` | Number format | organization, user | `en-US` | `en-US`, `de-DE`, `de-CH` or `fr-FR`. | no |  |
| `locale.firstDayOfWeek` | First day of the week | organization, user | `sunday` | `monday`, `sunday` or `saturday`. | no |  |

## My account › Notifications

### Events

| Key | Label | Levels | Default | Allowed values | Lockable | Hint |
|---|---|---|---|---|---|---|
| `notifications.mentions.inApp` | Mentions of me: In the app | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.mentions.email` | Mentions of me: E-mail | organization, user | `immediately` | `off`, `immediately` or `digest`. | yes |  |
| `notifications.mentions.push` | Mentions of me: Browser push | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.tasks.inApp` | Tasks assigned to me: In the app | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.tasks.email` | Tasks assigned to me: E-mail | organization, user | `immediately` | `off`, `immediately` or `digest`. | yes |  |
| `notifications.tasks.push` | Tasks assigned to me: Browser push | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.shares.inApp` | Pages shared with me and answers to my access requests: In the app | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.shares.email` | Pages shared with me and answers to my access requests: E-mail | organization, user | `immediately` | `off`, `immediately` or `digest`. | yes |  |
| `notifications.shares.push` | Pages shared with me and answers to my access requests: Browser push | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.accessRequests.inApp` | Access requests I can decide: In the app | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.accessRequests.email` | Access requests I can decide: E-mail | organization, user | `immediately` | `off`, `immediately` or `digest`. | yes |  |
| `notifications.accessRequests.push` | Access requests I can decide: Browser push | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.comments.inApp` | Comments and replies on content I watch: In the app | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.comments.email` | Comments and replies on content I watch: E-mail | organization, user | `digest` | `off`, `immediately` or `digest`. | yes |  |
| `notifications.comments.push` | Comments and replies on content I watch: Browser push | organization, user | `false` | `true` or `false`. | yes |  |
| `notifications.changes.inApp` | Changes to content I watch: In the app | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.changes.email` | Changes to content I watch: E-mail | organization, user | `off` | `off`, `immediately` or `digest`. | yes |  |
| `notifications.changes.push` | Changes to content I watch: Browser push | organization, user | `false` | `true` or `false`. | yes |  |
| `notifications.copies.inApp` | Copies I made: In the app | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.copies.email` | Copies I made: E-mail | organization, user | `off` | `off`, `immediately` or `digest`. | yes |  |
| `notifications.copies.push` | Copies I made: Browser push | organization, user | `false` | `true` or `false`. | yes |  |
| `notifications.blogPosts.inApp` | New posts in blogs I follow: In the app | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.blogPosts.email` | New posts in blogs I follow: E-mail | organization, user | `digest` | `off`, `immediately` or `digest`. | yes |  |
| `notifications.blogPosts.push` | New posts in blogs I follow: Browser push | organization, user | `false` | `true` or `false`. | yes |  |
| `notifications.meetings.inApp` | Meeting reminders and notes: In the app | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.meetings.email` | Meeting reminders and notes: E-mail | organization, user | `off` | `off`, `immediately` or `digest`. | yes |  |
| `notifications.meetings.push` | Meeting reminders and notes: Browser push | organization, user | `false` | `true` or `false`. | yes |  |
| `notifications.reviews.inApp` | Article reviews: In the app | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.reviews.email` | Article reviews: E-mail | organization, user | `digest` | `off`, `immediately` or `digest`. | yes |  |
| `notifications.reviews.push` | Article reviews: Browser push | organization, user | `false` | `true` or `false`. | yes |  |
| `notifications.ownershipAndStatus.inApp` | Ownership and page status changes: In the app | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.ownershipAndStatus.email` | Ownership and page status changes: E-mail | organization, user | `off` | `off`, `immediately` or `digest`. | yes |  |
| `notifications.ownershipAndStatus.push` | Ownership and page status changes: Browser push | organization, user | `false` | `true` or `false`. | yes |  |
| `notifications.spaceAdministration.inApp` | Space administration: In the app | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.spaceAdministration.email` | Space administration: E-mail | organization, user | `off` | `off`, `immediately` or `digest`. | yes |  |
| `notifications.spaceAdministration.push` | Space administration: Browser push | organization, user | `false` | `true` or `false`. | yes |  |
| `notifications.importsAndExports.inApp` | Imports and exports: In the app | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.importsAndExports.email` | Imports and exports: E-mail | organization, user | `off` | `off`, `immediately` or `digest`. | yes |  |
| `notifications.importsAndExports.push` | Imports and exports: Browser push | organization, user | `false` | `true` or `false`. | yes |  |
| `notifications.apiTokenExpiring.inApp` | API token expires soon: In the app | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.apiTokenExpiring.email` | API token expires soon: E-mail | organization, user | `immediately` | `off`, `immediately` or `digest`. | yes |  |
| `notifications.apiTokenExpiring.push` | API token expires soon: Browser push | organization, user | `false` | `true` or `false`. | yes |  |
| `notifications.apiTokenUnused.inApp` | API token unused: In the app | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.apiTokenUnused.email` | API token unused: E-mail | organization, user | `immediately` | `off`, `immediately` or `digest`. | yes |  |
| `notifications.apiTokenUnused.push` | API token unused: Browser push | organization, user | `false` | `true` or `false`. | yes |  |
| `notifications.guestExpiring.inApp` | Guest access ends soon: In the app | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.guestExpiring.email` | Guest access ends soon: E-mail | organization, user | `immediately` | `off`, `immediately` or `digest`. | yes |  |
| `notifications.guestExpiring.push` | Guest access ends soon: Browser push | organization, user | `false` | `true` or `false`. | yes |  |
| `notifications.guestInactive.inApp` | Guest is inactive: In the app | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.guestInactive.email` | Guest is inactive: E-mail | organization, user | `immediately` | `off`, `immediately` or `digest`. | yes |  |
| `notifications.guestInactive.push` | Guest is inactive: Browser push | organization, user | `false` | `true` or `false`. | yes |  |
| `notifications.accessExpiring.inApp` | Role or membership ends soon: In the app | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.accessExpiring.email` | Role or membership ends soon: E-mail | organization, user | `immediately` | `off`, `immediately` or `digest`. | yes |  |
| `notifications.accessExpiring.push` | Role or membership ends soon: Browser push | organization, user | `false` | `true` or `false`. | yes |  |
| `notifications.serviceAccountUnattended.inApp` | Service account without responsible person: In the app | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.serviceAccountUnattended.email` | Service account without responsible person: E-mail | organization, user | `immediately` | `off`, `immediately` or `digest`. | yes |  |
| `notifications.serviceAccountUnattended.push` | Service account without responsible person: Browser push | organization, user | `false` | `true` or `false`. | yes |  |
| `notifications.breakGlassStarted.inApp` | Break-glass access started: In the app | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.breakGlassStarted.email` | Break-glass access started: E-mail | organization, user | `immediately` | `off`, `immediately` or `digest`. | yes |  |
| `notifications.breakGlassStarted.push` | Break-glass access started: Browser push | organization, user | `false` | `true` or `false`. | yes |  |
| `notifications.authEmergencySignIn.inApp` | Emergency sign-in used: In the app | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.authEmergencySignIn.email` | Emergency sign-in used: E-mail | organization, user | `immediately` | `off`, `immediately` or `digest`. | yes |  |
| `notifications.authEmergencySignIn.push` | Emergency sign-in used: Browser push | organization, user | `false` | `true` or `false`. | yes |  |
| `notifications.accountRolesWithheld.inApp` | Administrative roles paused: In the app | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.accountRolesWithheld.email` | Administrative roles paused: E-mail | organization, user | `immediately` | `off`, `immediately` or `digest`. | yes |  |
| `notifications.accountRolesWithheld.push` | Administrative roles paused: Browser push | organization, user | `false` | `true` or `false`. | yes |  |
| `notifications.accountWithoutOrganization.inApp` | New account without organization: In the app | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.accountWithoutOrganization.email` | New account without organization: E-mail | organization, user | `immediately` | `off`, `immediately` or `digest`. | yes |  |
| `notifications.accountWithoutOrganization.push` | New account without organization: Browser push | organization, user | `false` | `true` or `false`. | yes |  |
| `notifications.accountHomeOrganizationChanged.inApp` | Home organization changed: In the app | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.accountHomeOrganizationChanged.email` | Home organization changed: E-mail | organization, user | `immediately` | `off`, `immediately` or `digest`. | yes |  |
| `notifications.accountHomeOrganizationChanged.push` | Home organization changed: Browser push | organization, user | `false` | `true` or `false`. | yes |  |
| `notifications.mailCredentialExpiring.inApp` | E-mail credential expires soon: In the app | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.mailCredentialExpiring.email` | E-mail credential expires soon: E-mail | organization, user | `immediately` | `off`, `immediately` or `digest`. | yes |  |
| `notifications.mailCredentialExpiring.push` | E-mail credential expires soon: Browser push | organization, user | `false` | `true` or `false`. | yes |  |
| `notifications.storageLevelReached.inApp` | File store fills up: In the app | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.storageLevelReached.email` | File store fills up: E-mail | organization, user | `immediately` | `off`, `immediately` or `digest`. | yes |  |
| `notifications.storageLevelReached.push` | File store fills up: Browser push | organization, user | `false` | `true` or `false`. | yes |  |
| `notifications.storageLevelCleared.inApp` | File store usage falls: In the app | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.storageLevelCleared.email` | File store usage falls: E-mail | organization, user | `immediately` | `off`, `immediately` or `digest`. | yes |  |
| `notifications.storageLevelCleared.push` | File store usage falls: Browser push | organization, user | `false` | `true` or `false`. | yes |  |
| `notifications.operationsUpdateAvailable.inApp` | New Lunedo version: In the app | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.operationsUpdateAvailable.email` | New Lunedo version: E-mail | organization, user | `immediately` | `off`, `immediately` or `digest`. | yes |  |
| `notifications.operationsUpdateAvailable.push` | New Lunedo version: Browser push | organization, user | `false` | `true` or `false`. | yes |  |
| `notifications.backupFailed.inApp` | A backup fails: In the app | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.backupFailed.email` | A backup fails: E-mail | organization, user | `immediately` | `off`, `immediately` or `digest`. | yes |  |
| `notifications.backupFailed.push` | A backup fails: Browser push | organization, user | `false` | `true` or `false`. | yes |  |
| `notifications.backupMissing.inApp` | No recent backup: In the app | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.backupMissing.email` | No recent backup: E-mail | organization, user | `immediately` | `off`, `immediately` or `digest`. | yes |  |
| `notifications.backupMissing.push` | No recent backup: Browser push | organization, user | `false` | `true` or `false`. | yes |  |
| `notifications.backupRecovered.inApp` | Backups work again: In the app | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.backupRecovered.email` | Backups work again: E-mail | organization, user | `immediately` | `off`, `immediately` or `digest`. | yes |  |
| `notifications.backupRecovered.push` | Backups work again: Browser push | organization, user | `false` | `true` or `false`. | yes |  |
| `notifications.backupTestRestoreFailed.inApp` | A test restore fails: In the app | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.backupTestRestoreFailed.email` | A test restore fails: E-mail | organization, user | `immediately` | `off`, `immediately` or `digest`. | yes |  |
| `notifications.backupTestRestoreFailed.push` | A test restore fails: Browser push | organization, user | `false` | `true` or `false`. | yes |  |
| `notifications.identityProviderCredentialExpiring.inApp` | Provider credential expires soon: In the app | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.identityProviderCredentialExpiring.email` | Provider credential expires soon: E-mail | organization, user | `immediately` | `off`, `immediately` or `digest`. | yes |  |
| `notifications.identityProviderCredentialExpiring.push` | Provider credential expires soon: Browser push | organization, user | `false` | `true` or `false`. | yes |  |
| `notifications.identityProviderSyncHeld.inApp` | Synchronization stopped before deactivating accounts: In the app | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.identityProviderSyncHeld.email` | Synchronization stopped before deactivating accounts: E-mail | organization, user | `immediately` | `off`, `immediately` or `digest`. | yes |  |
| `notifications.identityProviderSyncHeld.push` | Synchronization stopped before deactivating accounts: Browser push | organization, user | `false` | `true` or `false`. | yes |  |
| `notifications.spaceAdministratorTaken.inApp` | An administrator became space admin of my space: In the app | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.spaceAdministratorTaken.email` | An administrator became space admin of my space: E-mail | organization, user | `immediately` | `off`, `immediately` or `digest`. | yes |  |
| `notifications.spaceAdministratorTaken.push` | An administrator became space admin of my space: Browser push | organization, user | `false` | `true` or `false`. | yes |  |
| `notifications.signInNewBrowser.inApp` | Sign-in from a new browser: In the app | organization, user | `true` | `true` or `false`. | yes |  |
| `notifications.signInNewBrowser.email` | Sign-in from a new browser: E-mail | organization, user | `immediately` | `off`, `immediately` or `digest`. | yes |  |
| `notifications.signInNewBrowser.push` | Sign-in from a new browser: Browser push | organization, user | `false` | `true` or `false`. | yes |  |

### Daily digest

| Key | Label | Levels | Default | Allowed values | Lockable | Hint |
|---|---|---|---|---|---|---|
| `notifications.digestEnabled` | Send a daily summary by e-mail | organization, user | `true` | `true` or `false`. | no | When off, only in the app. |
| `notifications.digestTime` | Send the digest at | organization, user | `08:00` | A time of day as `HH:MM`, from `00:00` to `23:59`. | no | For every person in their time zone. |

### Watching

| Key | Label | Levels | Default | Allowed values | Lockable | Hint |
|---|---|---|---|---|---|---|
| `notifications.watchAutomatically` | Watch what I create, edit or comment on | user | `true` | `true` or `false`. | no | You get its changes and comments. |

## Organization › General

### Language and region

| Key | Label | Levels | Default | Allowed values | Lockable | Hint |
|---|---|---|---|---|---|---|
| `locale.language` | Language | instance, organization, user | `en` | `en` or `de`. | yes | For everyone who has not chosen their own. |
| `locale.timeZone` | Time zone | instance, organization, user | `UTC` | An IANA time zone, for example `Europe/Vienna`. | yes | For dates and times. |
| `locale.dateFormat` | Date format | organization, user | `D MMM YYYY` | `D MMM YYYY`, `DD.MM.YYYY`, `DD/MM/YYYY`, `MM/DD/YYYY` or `YYYY-MM-DD`. | no | How full dates look. |
| `locale.timeFormat` | Time format | organization, user | `12h` | `24h` or `12h`. | no | 24 or 12 hours. |
| `locale.numberFormat` | Number format | organization, user | `en-US` | `en-US`, `de-DE`, `de-CH` or `fr-FR`. | no | Separators for thousands and decimals. |
| `locale.firstDayOfWeek` | First day of the week | organization, user | `sunday` | `monday`, `sunday` or `saturday`. | no | Used in calendars and date pickers. |

## Organization › Notifications

### Events

The same settings as in [My account › Notifications](#my-account--notifications).

### Delivery

| Key | Label | Levels | Default | Allowed values | Lockable | Hint |
|---|---|---|---|---|---|---|
| `notifications.digestEnabled` | Send a daily summary by e-mail | organization, user | `true` | `true` or `false`. | no | When off, only in the app. |
| `notifications.digestTime` | Send the digest at | organization, user | `08:00` | A time of day as `HH:MM`, from `00:00` to `23:59`. | no | For every person in their time zone. |
| `notifications.retentionDays` | Retention of notifications | instance, organization | `90` | A whole number from 1 to 3,650. | yes | Older notifications are deleted. |

## Organization › People and access › Domains and guests

### Registration and groups

| Key | Label | Levels | Default | Allowed values | Lockable | Hint |
|---|---|---|---|---|---|---|
| `organizations.selfRegistration` | Self-registration | organization | `false` | `true` or `false`. | yes | With an address of these domains. |
| `organizations.membersCreateGroups` | Members create groups | organization | `false` | `true` or `false`. | yes | And manage the groups they created. |

### Guests and expiry

| Key | Label | Levels | Default | Allowed values | Lockable | Hint |
|---|---|---|---|---|---|---|
| `organizations.guestExpiryReminderDays` | Guest expiry reminder | organization | `7` | A whole number from 1 to 90. | yes | Reminder before guest access ends. |
| `organizations.guestInactivityDays` | Inactive guests | organization | `30` | A whole number from 1 to 365. | yes | Notice when a guest is inactive. |
| `organizations.expiryReminderDays` | Access expiry reminder | organization | `7` | A whole number from 1 to 90. | yes | For roles and memberships that expire. |

## Organization › Content › Spaces

### Creating spaces

| Key | Label | Levels | Default | Allowed values | Lockable | Hint |
|---|---|---|---|---|---|---|
| `spaces.membersCreateSpaces` | Members create spaces | organization | `true` | `true` or `false`. | yes | Members create spaces. |
| `spaces.membersCreateConfidentialSpaces` | Members create confidential spaces | organization | `true` | `true` or `false`. | yes | Members create confidential spaces. |

### Clean up

| Key | Label | Levels | Default | Allowed values | Lockable | Hint |
|---|---|---|---|---|---|---|
| `spaces.cleanupGraceDays` | Waiting period before clean-up | organization | `30` | A whole number from 7 to 3,650. | no | Waiting period, at least 7 days. |

## Organization › Content › Pages and trash

### Pages

| Key | Label | Levels | Default | Allowed values | Lockable | Hint |
|---|---|---|---|---|---|---|
| `pages.defaultMode` | Default mode of new pages | organization, space | `publish` | `publish` or `live`. | yes | How new pages are published. |
| `pages.liveVersionIdleMinutes` | Version after a pause in live mode | organization, space | `10` | A whole number from 1 to 1,440. | yes | Or when the last person leaves the page. |

### Trash

| Key | Label | Levels | Default | Allowed values | Lockable | Hint |
|---|---|---|---|---|---|---|
| `trash.firstStageDays` | Time in the trash | organization, space | `90` | A whole number from 1 to 3,650. | yes | How long Editors restore items themselves. |
| `trash.secondStageDays` | Time in second-stage recovery | organization, space | `45` | A whole number from 1 to 3,650. | yes | Then only Space admins restore it. |

### Collaboration

| Key | Label | Levels | Default | Allowed values | Lockable | Hint |
|---|---|---|---|---|---|---|
| `reactions.enabled` | Reactions | organization, space | `true` | `true` or `false`. | yes | On pages, blog posts and comments. |

### Sharing

| Key | Label | Levels | Default | Allowed values | Lockable | Hint |
|---|---|---|---|---|---|---|
| `sharing.shareLinks` | Share links | organization | `true` | `true` or `false`. | yes | Links for people and the organization. |
| `sharing.anyoneLinks` | Links for anyone without signing in | instance, organization | `false` | `true` or `false`. | yes | Every link needs an expiry date. |
| `sharing.anyoneLinkMaxDays` | Longest lifetime of a link for anyone | instance, organization | `30` | A whole number from 1 to 3,650. | yes | Organizations can only shorten it. |
| `sharing.membersInviteGuests` | Members can invite guests to a page | organization | `false` | `true` or `false`. | yes | Everyone who may share, by e-mail. |

### Files

| Key | Label | Levels | Default | Allowed values | Lockable | Hint |
|---|---|---|---|---|---|---|
| `files.maxFileSizeMegabytes` | Largest file to upload | instance, organization | `100` | A whole number from 1 to 100,000. | yes | Larger uploads are refused. |
| `files.keepVersions` | Versions of a file to keep | organization, space | `50` | A whole number from 1 to 1,000,000 or `unlimited`. | yes | Older file versions are removed. |

## Organization › Integrations and security › Security

### Sign-in

| Key | Label | Levels | Default | Allowed values | Lockable | Hint |
|---|---|---|---|---|---|---|
| `auth.twoFactorRequired` | Require two-factor authentication | instance, organization | `false` | `true` or `false`. | yes | Everyone sets up a second factor. |
| `auth.passwordMinLength` | Minimum password length | instance, organization | `12` | A whole number from 8 to 256. | yes | Organizations can only raise it. |
| `auth.reauthenticationMinutes` | Confirmation for sensitive changes | instance, organization | `10` | A whole number from 1 to 60. | yes | How long a renewed confirmation stays valid. |
| `auth.sessionIdleTimeoutMinutes` | Sign out after inactivity | instance, organization | `10080` | A whole number from 5 to 525,600. | yes | How long you stay signed in without activity. |
| `auth.sessionLifetimeMinutes` | Maximum session length | instance, organization | `43200` | A whole number from 5 to 525,600. | yes | Then sign in again, even when active. |
| `auth.maxSessionsPerAccount` | Sessions per account | instance, organization | `10` | A whole number from 1 to 100. | yes | Above this, the oldest session ends. |

### API tokens

| Key | Label | Levels | Default | Allowed values | Lockable | Hint |
|---|---|---|---|---|---|---|
| `apiTokens.maxLifetimeDays` | Maximum lifetime of API tokens | instance, organization | none | A whole number from 1 to 3,650 or none. | yes | Organizations can only shorten it. |

## Instance › General

### Instance

| Key | Label | Levels | Default | Allowed values | Lockable | Hint |
|---|---|---|---|---|---|---|
| `instance.name` | Instance name | instance | `Lunedo` | Text of at most 100 characters. | no | On the sign-in page and in e-mails. |
| `instance.url` | Address | instance | empty | Empty or text of at most 2048 characters. | no | For links, e-mails and passkeys. |
| `branding.accentColor` | Accent color | instance | `petrol` | `petrol`, `blue`, `violet`, `amber`, `red`, `green` or `gray`. | no | For the main action, links and focus. |

### Language and region

| Key | Label | Levels | Default | Allowed values | Lockable | Hint |
|---|---|---|---|---|---|---|
| `locale.language` | Language | instance, organization, user | `en` | `en` or `de`. | yes | For everyone who has not chosen their own. |
| `locale.timeZone` | Time zone | instance, organization, user | `UTC` | An IANA time zone, for example `Europe/Vienna`. | yes | For dates and times. |

## Instance › Operations › Updates

### Update check

| Key | Label | Levels | Default | Allowed values | Lockable | Hint |
|---|---|---|---|---|---|---|
| `operations.updateCheck` | Check for updates | instance | `true` | `true` or `false`. | no | Look for new versions once a day. |

## Instance › Operations › Storage

### Reminders

| Key | Label | Levels | Default | Allowed values | Lockable | Hint |
|---|---|---|---|---|---|---|
| `storage.reminder` | Reminder while a level is active | instance | `weekly` | `off`, `daily`, `weekly` or `monthly`. | no | How often a warning is repeated. |

## Instance › People and sign-in › Policies

### Sign-in

| Key | Label | Levels | Default | Allowed values | Lockable | Hint |
|---|---|---|---|---|---|---|
| `auth.twoFactorRequired` | Require two-factor authentication | instance, organization | `false` | `true` or `false`. | yes | Everyone sets up a second factor. |
| `auth.passwordMinLength` | Minimum password length | instance, organization | `12` | A whole number from 8 to 256. | yes | Organizations can only raise it. |
| `auth.reauthenticationMinutes` | Confirmation for sensitive changes | instance, organization | `10` | A whole number from 1 to 60. | yes | How long a renewed confirmation stays valid. |
| `auth.sessionIdleTimeoutMinutes` | Sign out after inactivity | instance, organization | `10080` | A whole number from 5 to 525,600. | yes | How long you stay signed in without activity. |
| `auth.sessionLifetimeMinutes` | Maximum session length | instance, organization | `43200` | A whole number from 5 to 525,600. | yes | Then sign in again, even when active. |
| `auth.maxSessionsPerAccount` | Sessions per account | instance, organization | `10` | A whole number from 1 to 100. | yes | Above this, the oldest session ends. |

### Protection against attacks

| Key | Label | Levels | Default | Allowed values | Lockable | Hint |
|---|---|---|---|---|---|---|
| `auth.signInAttemptsPerAccountPerMinute` | Sign-in attempts per account | instance | `10` | A whole number from 1 to 1,000. | no | Then refused for one minute. |
| `auth.signInAttemptsPerClientPerMinute` | Failed sign-in attempts per client | instance | `30` | A whole number from 1 to 10,000. | no | Only failures count, per IP address. |
| `auth.lockoutFailuresPerAccount` | Failures before an account is locked | instance | `5` | A whole number from 3 to 1,000. | no | Within the lockout window. |
| `auth.lockoutFailuresPerClient` | Failures before a client is locked | instance | `20` | A whole number from 3 to 10,000. | no | Within the lockout window, per IP address. |
| `auth.lockoutWindowMinutes` | Lockout window | instance | `15` | A whole number from 1 to 1,440. | no | Failures within it count together. |
| `auth.lockoutMinutes` | First lockout | instance | `1` | A whole number from 1 to 1,440. | no | Repeated lockouts grow longer. |
| `auth.lockoutMaxMinutes` | Maximum lockout | instance | `60` | A whole number from 1 to 10,080. | no | The longest a lockout lasts. |

### API tokens

| Key | Label | Levels | Default | Allowed values | Lockable | Hint |
|---|---|---|---|---|---|---|
| `apiTokens.maxLifetimeDays` | Maximum lifetime of API tokens | instance, organization | none | A whole number from 1 to 3,650 or none. | yes | Organizations can only shorten it. |
| `apiTokens.requestsPerMinute` | Requests per token | instance | `600` | A whole number from 1 to 100,000. | no | Further requests are refused for a moment. |
| `apiTokens.expiryReminderDays` | Expiry reminder | instance | `7` | A whole number from 1 to 90. | no | The person who owns the token is reminded. |
| `apiTokens.unusedNoticeDays` | Unused API tokens | instance | `90` | A whole number from 7 to 3,650. | no | After that, the owner is told. |
| `apiTokens.publicDocumentation` | Public API reference | instance | `false` | `true` or `false`. | no | API reference without signing in. |

### Sharing

| Key | Label | Levels | Default | Allowed values | Lockable | Hint |
|---|---|---|---|---|---|---|
| `sharing.anyoneLinks` | Links for anyone without signing in | instance, organization | `false` | `true` or `false`. | yes | Every link needs an expiry date. |
| `sharing.anyoneLinkMaxDays` | Longest lifetime of a link for anyone | instance, organization | `30` | A whole number from 1 to 3,650. | yes | Organizations can only shorten it. |

### Files

| Key | Label | Levels | Default | Allowed values | Lockable | Hint |
|---|---|---|---|---|---|---|
| `files.maxFileSizeMegabytes` | Largest file to upload | instance, organization | `100` | A whole number from 1 to 100,000. | yes | Larger uploads are refused. |
| `files.keepVersionsMaximum` | Most versions organizations and spaces may keep | instance | `500` | A whole number from 1 to 1,000,000 or `unlimited`. | no | Only here “No limit” is possible. |

### Trash

| Key | Label | Levels | Default | Allowed values | Lockable | Hint |
|---|---|---|---|---|---|---|
| `trash.firstStageMinimumDays` | Shortest time in the trash | instance | `1` | A whole number from 1 to 3,650. | no | Organizations and spaces can only extend it. |
| `trash.secondStageMinimumDays` | Shortest time in second-stage recovery | instance | `1` | A whole number from 1 to 3,650. | no | Organizations and spaces can only extend it. |

### Imports

| Key | Label | Levels | Default | Allowed values | Lockable | Hint |
|---|---|---|---|---|---|---|
| `imports.maxUploadMegabytes` | Largest export to upload | instance | `2048` | A whole number from 1 to 1,000,000. | no | Larger exports are refused. |
| `imports.maxOrganizationMegabytes` | Import storage per organization | instance | `20480` | A whole number from 1 to 10,000,000. | no | Import storage per organization. |
| `imports.folderEnabled` | Import folder | instance | `true` | `true` or `false`. | no | Imports from the folder on the server. |
| `imports.atlassianHosts` | Further Atlassian sites | instance | empty | Up to 50 host names such as `wiki.example.com`, separated by commas. | no | Host names, separated by commas. |

### Organizations and spaces

| Key | Label | Levels | Default | Allowed values | Lockable | Hint |
|---|---|---|---|---|---|---|
| `organizations.selfServiceCreation` | Self-service organizations | instance | `false` | `true` or `false`. | no | Members create organizations. |
| `spaces.personalSpaces` | Personal spaces | instance | `true` | `true` or `false`. | no | An own space for every person. |

### Retention

| Key | Label | Levels | Default | Allowed values | Lockable | Hint |
|---|---|---|---|---|---|---|
| `audit.retentionDays` | Audit log retention | instance | `365` | A whole number from 1 to 36,500. | no | Older events are removed. |
| `identityProviders.syncLogRetentionDays` | Keep synchronization logs for | instance | `90` | A whole number from 7 to 3,650. | no | Older logs are removed. |
| `notifications.retentionDays` | Retention of notifications | instance, organization | `90` | A whole number from 1 to 3,650. | yes | Older notifications are deleted. |

## Instance › People and sign-in › Emergency access to organizations

### Emergency access to organizations

| Key | Label | Levels | Default | Allowed values | Lockable | Hint |
|---|---|---|---|---|---|---|
| `organizations.breakGlassMinutes` | Break-glass duration | instance | `240` | A whole number from 5 to 1,440. | no | Then it ends by itself. |

## Instance › Services › Delivery

### Delivery

| Key | Label | Levels | Default | Allowed values | Lockable | Hint |
|---|---|---|---|---|---|---|
| `mail.sendRatePerMinute` | E-mails per minute | instance | `30` | A whole number from 1 to 10,000. | no | Further e-mails wait for the next minute. |

### Browser push

| Key | Label | Levels | Default | Allowed values | Lockable | Hint |
|---|---|---|---|---|---|---|
| `notifications.browserPush` | Browser push | instance | `false` | `true` or `false`. | no | Through the push services of browsers. |

## Other settings

Settings that have no entry in the settings search.

| Key | Label | Levels | Default | Allowed values | Lockable | Hint |
|---|---|---|---|---|---|---|
| `appearance.categoryView` | Categories in knowledge bases | user | `automatic` | `automatic`, `mine` or `all`. | no | Your categories or all of them. |
| `appearance.editorToolbar` | Editor toolbar | user | `true` | `true` or `false`. | no | Whether the formatting toolbar is shown. |
| `appearance.folderView` | Folder view | user | `list` | `list` or `tiles`. | no | Folder contents as list or tiles. |
| `appearance.sidebarCollapsed` | Collapsed sidebar | user | `false` | `true` or `false`. | no | Whether the sidebar is collapsed. |
| `appearance.sidebarCollapsedWhileEditing` | Collapsed sidebar while editing | user | `true` | `true` or `false`. | no | Whether the sidebar is collapsed while you edit. |
| `appearance.startPage` | Start page | user | `forYou` | `forYou` or `organizationHome`. | no | Where you land after signing in. |
| `appearance.tablePageSize` | Rows per page | user | `25` | `25`, `50` or `100`. | no | Rows per page in lists. |
| `auth.emergencySignInRecipients` | Emergency sign-in of the owner | instance | `{"instanceAdministrators":true,"accounts":[],"addresses":[]}` | A structured value. | no | Who is told when the owner signs in in an emergency. |
| `content.language` | Content language | space | none | `ar`, `ca`, `da`, `de`, `el`, `en`, `es`, `eu`, `fi`, `fr`, `ga`, `hi`, `hu`, `hy`, `id`, `it`, `lt`, `nb`, `ne`, `nl`, `pt`, `ro`, `ru`, `sr`, `sv`, `ta`, `tr`, `yi` or `other` or none. | no | Language of the pages, for search. |
| `embeds.allowedServices` | Allowed embed services | organization | none | A list of up to 50 entries or none. | no | Services of the instance this organization allows. |
| `embeds.services` | External embeds allowlist | instance | a list of 7 entries | A list of up to 50 entries, each a structured value. | no | Services pages may embed. |
| `help.knowledgeBase` | Knowledge base behind the help icon | organization | empty | Empty or an ID. | no | Opens from the help icon for everyone signed in. |
| `home.organizationPage` | Organization home page | organization | none | An ID or none. | no | Where members land who choose it as their start page. |
| `mail.graph` | Microsoft Graph | instance | none | A structured value or none. | no | Sending through Microsoft Graph. |
| `mail.method` | Sending method | instance | `smtp` | `smtp` or `graph`. | no | SMTP or Microsoft Graph. |
| `mail.smtp` | Mail server | instance | none | A structured value or none. | no | SMTP server for outgoing e-mail. |
| `pages.status` | Page status | space | `true` | `true` or `false`. | no | Marks how far a page is. |
| `portal.appLinkName` | Name of the link to the app | instance | empty | Text of at most 60 characters. | no | In the account menu of the portal. |
| `spaces.defaultPermissions` | Default permissions for new spaces | organization | a structured value | A structured value. | no | The creator of a space can change them. |
| `spaces.export` | Allow export | space | `true` | `true` or `false`. | no | As PDF, Word, HTML and Markdown. |
| `storage.criticalPercent` | Critical storage level | instance | `95` | A whole number from 1 to 100. | no | Uploads are refused too. |
| `storage.largeWritesPercent` | Storage level for pausing large writes | instance | `90` | A whole number from 1 to 100. | no | New exports and imports are refused. |
| `storage.operationsEmails` | Operations contacts | instance | empty | A list of up to 20 entries, each an e-mail address. | no | E-mail addresses for operations warnings. |
| `storage.s3LimitBytes` | Limit for stored files | instance | none | A whole number of at least 1 or none. | no | Limit for the warning, or empty. |
| `storage.warningPercent` | Storage warning level | instance | `80` | A whole number from 1 to 100. | no | Informs, blocks nothing. |
