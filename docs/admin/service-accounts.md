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

Unused tokens are the safeguard against forgotten service accounts: a token that is not used for a while triggers a notice, and an expiry, when set or required, stops it. The limits are instance settings under **Settings › Instance › People and sign-in › Policies**, section **API tokens**.

They are **Maximum lifetime of API tokens**, **Expiry reminder** and **Unused API tokens** in days, and **Requests per token** per minute. The [Settings reference](settings-reference.md#instance--people-and-sign-in--policies) lists each of them with its key, default and allowed values.

Organizations set a shorter maximum lifetime under **Settings › Organization › Integrations and security › Security**.

## Deactivating a service account

Select **Deactivate service account** on its page. All its tokens are revoked at once. A deactivated service account cannot be activated again; create a new one instead. Deactivating checks the actor's rank like removing a role, see [Roles and permissions](roles-and-permissions.md#who-may-act-on-whom).
