# Organizations, members and roles

Routes for organizations, members, groups, roles and settings, and for the accounts of the instance. [Organizations](../admin/organizations.md) and [Roles and permissions](../admin/roles-and-permissions.md) explain the concepts. Only the public routes are listed; the full reference is at `/api/docs` on your instance.

A token needs the matching area in its scopes, for example `membersAndGroups` for members and groups; see [Authentication](authentication.md#scopes).

## Organizations

| Route | What it does | Permission |
|---|---|---|
| `POST /api/v1/organizations` | Creates an organization with an owner, the caller unless another account is named | `instance.organizations.create` |
| `GET`, `PATCH /api/v1/organizations/{organizationId}` | Reads and changes name, short name (`slug`), default language, time zone and logo reference | `organization.view`, `organization.update` |
| `PUT`, `DELETE /api/v1/organizations/{organizationId}/logo` | Uploads and removes the logo | `organization.update` |
| `GET /api/v1/organizations/{organizationId}/domains` | Lists the domains of the organization | `organization.signIn.view` |
| `POST /api/v1/organizations/{organizationId}/domains`, `DELETE …/domains/{domain}` | Adds and removes a domain | `instance.organizations.manage` |
| `GET /api/v1/organizations/{organizationId}/settings` | Settings with their value at each level | `organization.settings.view` |
| `PUT /api/v1/organizations/{organizationId}/settings/{key}` | Sets, clears or locks a setting | `organization.settings.manage`; `organization.signIn.manage` for sign-in settings |
| `GET /api/v1/organizations/{organizationId}/storage` | Storage used by the attachments of all spaces | `organization.spaces.view` |

A setting change takes `value`, `clear: true` to remove the value at this level so the level above applies, or `locked` to lock or unlock it for the levels below. Send at least one of them.

## Members and invitations

| Route | What it does | Permission |
|---|---|---|
| `GET /api/v1/organizations/{organizationId}/members` | Lists members; `q` searches names and e-mail addresses. `managedBy` is included only for callers with `organization.members.manage` | `organization.members.view` |
| `GET`, `PATCH`, `DELETE /api/v1/organizations/{organizationId}/members/{accountId}` | Reads, changes and ends a membership; `GET` includes `managedBy` | `organization.members.manage` |
| `GET /api/v1/organizations/{organizationId}/members/{accountId}/permissions` | Explains a member's permissions | `organization.members.manage` |
| `GET`, `POST /api/v1/organizations/{organizationId}/invitations`, `DELETE …/invitations/{invitationId}` | Lists, sends and revokes invitations | `organization.members.manage` |
| `GET /api/v1/organizations/{organizationId}/people/{accountId}/access` | All access of a person with the reason for each entry | `organization.access.view` |
| `GET /api/v1/organizations/{organizationId}/access-overview` | The access of every member, or of one person, as CSV | `organization.access.view` |

An invitation is sent by e-mail; its link works once and expires.

## Groups

| Route | What it does | Permission |
|---|---|---|
| `GET`, `POST /api/v1/organizations/{organizationId}/groups` | Lists and creates groups | `organization.groups.view`, `organization.groups.create` |
| `GET`, `PATCH`, `DELETE /api/v1/groups/{groupId}` | Reads, changes and deletes a group | `group.view`, `group.manage`, `group.delete` |
| `GET`, `POST /api/v1/groups/{groupId}/members`, `DELETE …/members/{accountId}` | Members of a group | `group.view`, `group.manage` |
| `POST /api/v1/groups/{groupId}/managers`, `DELETE …/managers/{accountId}` | Managers of a group | `group.manage` |

Groups that come from an identity provider are kept in step by the provider; see [Identity provider groups](../admin/identity-providers/identity-provider-groups.md).

## Roles

| Route | What it does | Permission |
|---|---|---|
| `GET`, `POST /api/v1/organizations/{organizationId}/roles`, `PATCH`, `DELETE …/roles/{roleId}` | Custom roles of the organization | `organization.roles.view`, `organization.roles.manage` |
| `GET`, `POST /api/v1/organizations/{organizationId}/role-assignments`, `DELETE …/role-assignments/{assignmentId}` | Who holds which role | `organization.roles.view`, `organization.roles.manage` |
| `GET`, `POST /api/v1/instance/roles`, `PATCH`, `DELETE …/roles/{roleId}` | Instance roles | `instance.roles.view`, `instance.roles.manage` |
| `GET`, `POST /api/v1/instance/role-assignments`, `DELETE …/role-assignments/{assignmentId}` | Who holds which instance role | `instance.roles.view`, `instance.roles.manage` |

Nobody can give a role more than they hold themselves.

## Instance

| Route | What it does | Permission |
|---|---|---|
| `GET /api/v1/instance/organizations` | All organizations with their owners, number of members and domains | `instance.organizations.view` |
| `GET /api/v1/instance/accounts` | All accounts, including service accounts, with instance roles, second-factor state, `managedBy` and last sign-in; `q` searches | `instance.accounts.view` |
| `POST /api/v1/instance/accounts/placeholders` | Creates a placeholder for a person without an account | `instance.accounts.manage` |
| `POST /api/v1/instance/accounts/{accountId}/merge` | Merges a placeholder into an account | `instance.accounts.manage`, session only |
| `POST /api/v1/instance/accounts/{accountId}/anonymize` | Anonymizes an account for good | `instance.accounts.manage`, session only |
| `POST /api/v1/instance/accounts/{accountId}/organization` | Gives an account without an organization a home organization | `instance.accounts.manage` |
| `GET /api/v1/instance/settings` | Instance settings | `instance.settings.view` |
| `PUT /api/v1/instance/settings/{key}` | Sets, clears or locks an instance setting | the `manage` level of the setting's area: settings, sign-in, audit log or organizations |

"Session only" routes need a signed-in session with a recent confirmation of identity and refuse API tokens; use the interface for them. See [Accounts](../admin/accounts.md).

## Accounts

These routes act on another account. They are open to instance administrators with the area Accounts and Manage, and to administrators with Members and groups and Manage in the account's home organization; the [rank rules](../admin/roles-and-permissions.md#who-may-act-on-whom) apply.

| Route | What it does | Permission |
|---|---|---|
| `POST /api/v1/accounts/{accountId}/deactivate` | Deactivates an account and ends its sessions | `account.deactivate`, session only |
| `POST /api/v1/accounts/{accountId}/reactivate` | Lets a deactivated account sign in again; revoked tokens and ended memberships stay as they are | `account.reactivate`, session only |
| `POST /api/v1/accounts/{accountId}/sessions/end`, `POST …/sessions/{sessionId}/end` | Ends all sessions, or one session, of the account | `account.sessions.end`, session only |
| `POST /api/v1/accounts/{accountId}/second-factor/reset` | Removes the second factor; the account sets up a new one at the next sign-in. Refused with `managedAccount` for accounts managed through OIDC or SAML | `account.secondFactor.reset`, session only |
| `PUT /api/v1/accounts/{accountId}/home-organization` | Makes another organization the account is a member of its home organization: `{ "organizationId": … }` | `account.homeOrganization.change` |

### Managing provider

`managedBy` names the identity provider that manages an account, or is `null` for a local account (see [Managed accounts](../admin/identity-providers.md#managed-accounts)):

| Field | Meaning |
|---|---|
| `providerId`, `providerName` | The identity provider |
| `providerType` | `oidc`, `saml` or `ldap`; further kinds may be added |
| `source` | `identity` when an identity of the provider is linked, `domain` when the account's e-mail domain is assigned to it |
| `since` | Since when the provider manages the account |

Accounts managed through `oidc` or `saml` sign in only through the provider and have no password or second factor in Lunedo; `POST /api/v1/accounts/{accountId}/second-factor/reset` refuses them with `managedAccount`.

## Service accounts

| Route | What it does | Permission |
|---|---|---|
| `GET`, `POST /api/v1/organizations/{organizationId}/service-accounts` | Lists and creates service accounts | `organization.integrations.view`, `organization.integrations.manage` |
| `GET`, `PATCH /api/v1/service-accounts/{serviceAccountId}` | Reads and changes a service account and its responsible people | `serviceAccount.view`, `serviceAccount.manage` |
| `POST /api/v1/service-accounts/{serviceAccountId}/deactivate` | Deactivates it and revokes all its tokens | `serviceAccount.manage` |

The tokens of a service account are created in the interface; see [Service accounts](../admin/service-accounts.md).
