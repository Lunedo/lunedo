# Service accounts

A service account belongs to an organization and acts only through API tokens: it has no password, no sessions and no interactive sign-in. Use one service account per script or integration. Service accounts are managed under **Settings › Organization › Integrations and security › Service accounts** by holders of the organization area Integrations and API: View shows them, Manage creates, changes and deactivates them.

A service account is a principal of its own. Its permissions come only from its own roles, space roles and group memberships, which can be much narrower than those of any person. Nobody can give it more than they hold themselves, and creating a token for it passes the same check as giving a role, see [Roles and permissions](roles-and-permissions.md#giving-access). A service account cannot be an owner.

## Creating a service account

1. Open **Settings › Organization › Integrations and security › Service accounts**.
2. Select **Create service account**, enter a name and an optional description. You become its responsible person.
3. Give it the roles it needs under **Settings › Organization › People and access › Roles**, or the space roles it needs in the spaces it works in.
4. On the service account's page, create a token under **Tokens**. A token can do at most what the service account can. How tokens, scopes and their lifetime work is described in [API authentication](../api/authentication.md).

## Responsible people

A service account has zero, one or several responsible people, by default its creator. They receive reminders before its tokens expire and notices about it; without any, the organization's owners receive them. Responsible people grant no permissions and limit none. Holders of Integrations and API with Manage change the list with **Add responsible person** and **Remove responsible person**, and every change is recorded in the audit log.

When the last responsible person leaves the organization or is deactivated, the organization's owners are notified once (event **Service account without responsible person**) and the list shows the service account with **No responsible person**. Its permissions do not change. Add a responsible person or deactivate it.

## Tokens and reminders

Unused tokens are the safeguard against forgotten service accounts: a token that is not used for a while triggers a notice, and an expiry, when set or required, stops it. The limits are instance settings under **Settings › Instance › People and sign-in › Policies**, section **API tokens**:

| Setting | Key | Default | Range |
|---|---|---|---|
| Maximum lifetime of API tokens | `apiTokens.maxLifetimeDays` | No limit | 1 to 3650 days; organizations can only shorten it |
| Expiry reminder | `apiTokens.expiryReminderDays` | 7 days | 1 to 90 days |
| Unused API tokens | `apiTokens.unusedNoticeDays` | 90 days | 7 to 3650 days |
| Requests per token | `apiTokens.requestsPerMinute` | 600 per minute | 1 to 100000 |

Organizations set a shorter maximum lifetime under **Settings › Organization › Integrations and security › Security**.

## Deactivating a service account

Select **Deactivate service account** on its page. All its tokens are revoked at once. A deactivated service account cannot be activated again; create a new one instead. Deactivating checks the actor's rank like removing a role, see [Roles and permissions](roles-and-permissions.md#who-may-act-on-whom).
