# Organizations and permissions

An instance contains one or more organizations. Each has its own members, groups, roles and settings. Organizations are invisible to each other: a request for an organization the caller cannot see is answered with `404`, like a request for one that does not exist.

## Organizations

An organization has a name, a slug that is unique regardless of case, a language, a time zone and a logo reference. Language and time zone are organization-level settings, so members inherit them unless they choose their own.

Instance administrators assign e-mail domains to organizations. A domain belongs to at most one organization. When an account is created with a verified address in an assigned domain, through an invitation or self-registration, that organization becomes its home organization. Changes of the home organization of existing accounts follow with identity providers.

Self-service creation of organizations is the instance setting `organizations.selfServiceCreation` (default off). When it is on, every active standard account may create organizations.

## Memberships

Every standard account has exactly one home organization and is a member of it. An account can be a member of further organizations, with a different role in each.

| Kind | Who | Limits |
|---|---|---|
| Member | Standard accounts | Holds organization roles |
| Collaborator | Standard accounts of another organization | Sees the organization and what is shared explicitly; holds no organization roles |
| Guest | Guest accounts | Like collaborators; has a responsible person and an optional expiry |

Members see the members of their organizations. Collaborators and guests do not.

Memberships, role assignments and group memberships can expire. Expiry takes effect at the moment it passes, on every node, because every permission check compares it with the database clock. A job removes expired entries every minute and records them in the audit log. The responsible people are reminded by e-mail a configurable number of days before (`organizations.expiryReminderDays`, default 7).

An account cannot leave its home organization; deactivate it instead. Deactivation ends all sessions of the account at once. Administrators of the home organization and instance administrators can deactivate accounts, except the instance owner, the last owner of an organization and themselves.

### Guests

A guest has a responsible person, by default the person who invited them. The responsible person is reminded before the guest's access expires (`organizations.guestExpiryReminderDays`, default 7) and is told when the guest has not been active for a while (`organizations.guestInactivityDays`, default 30). When the responsible person leaves or is deactivated, the organization's owners and administrators take over.

## Roles

Permissions are grouped into areas. A role gives each area `view` or `manage`; `manage` includes `view`.

| Instance area | Organization area |
|---|---|
| Organizations | Members and groups |
| Accounts | Spaces |
| Sign-in and security | Settings |
| Settings | Sign-in and security |
| Operations | Integrations and API |
| Audit log | Audit log |

Built-in roles use the same areas as custom roles:

| Role | Areas |
|---|---|
| Instance owner | All instance areas: manage. Exactly one; transfers ownership to an instance administrator after re-authentication. |
| Instance administrator | All instance areas: manage |
| Security auditor | All instance areas: view |
| Organization owner | All organization areas: manage. At least one; the last owner cannot leave or be removed. |
| Organization administrator | All organization areas: manage |
| Member | Members and groups: view |

Rules:

- Instance roles never grant access to organizations. An instance administrator who is not a member sees an organization only through break-glass access.
- Only owners appoint owners. Everybody else assigns roles up to their own level: the role's areas must be covered by the areas the assigner holds.
- Nobody extends their own permissions. Temporary roles and break-glass access do not count when an assignment would include the assigner.
- Roles are assigned to accounts, groups, all members of an organization or all internal users of the instance. Owners are always individual accounts and never expire.

## Groups

Groups belong to an organization and contain members of it. A group may have a single member. Groups are not nested. Organization administrators create groups; members can when the organization setting `organizations.membersCreateGroups` is on. The creator becomes the first group manager and can add further managers. Adding someone to a group that holds roles requires the right to assign those roles.

## Invitations and self-registration

Invitations go by e-mail, are valid for 7 days, work once and are stored as hashes. Accepting an invitation creates the account, with a verified address, or adds the membership to the existing account with that address. Collaborators join with their existing account. An invitation can carry a role up to the inviter's level.

Self-registration is the setting `organizations.selfRegistration` (default off). When an organization enables it, people with an address in one of its domains receive a confirmation link and create their account themselves. The answer to a registration request is the same whether it is accepted or not.

## Break-glass access

An instance administrator can request access to an organization with a reason. The access gives the organization administrator role, never more, for `organizations.breakGlassMinutes` (default 240) and ends early when the requester ends it. The organization's owners receive an e-mail at once. Start, every permitted action and the end are recorded in the organization's audit log.

## Authorization service

The authorization service is the only place that decides whether a principal may perform an action on a resource. Resource types register their actions: each action names the area and level that grant it, membership kinds that grant it, or a rule, such as group managers managing their group. Every API route declares its action with `@Permission(...)`; the global guard asks the service before the handler runs.

Principals are accounts, including service accounts, groups, all members of an organization, all internal users, anonymous and system. A request with an API token is limited further by the token's scopes, see [api.md](api.md). Decisions are computed per request and cached only for the length of a request, so a change of roles, memberships or account state takes effect on the next request on every node.

`explain` returns why a principal has or lacks a permission: the role, how it is held (directly, through a group, through all members, through break-glass access) and, when denied, the reason, for example `notMember`, `limitedMembership`, `noRoleGrantsArea`, `ownerOnly`, `instanceRolesDoNotGrantOrganizationAccess` or `tokenScope`.

A permission matrix test generates every combination of account kind, principal kind, built-in role, a custom role per area and registered action, and compares each decision with a model of the rules. New actions and roles are covered without changing the test; an action with a rule the model does not know fails it.

## Endpoints

Each endpoint declares the action it requires. Endpoints marked internal serve the web client and are left out of the public API reference; the others are described at `/api/docs`, see [api.md](api.md).

| Endpoint | Action |
|---|---|
| `GET /api/v1/organizations` | session: organizations of the caller; internal |
| `POST /api/v1/organizations` | `instance.organizations.create` |
| `GET, PATCH /api/v1/organizations/{id}` | `organization.view`, `organization.update` |
| `GET /api/v1/organizations/{id}/domains` | `organization.signIn.view` |
| `POST, DELETE /api/v1/organizations/{id}/domains` | `instance.organizations.manage` |
| `GET /api/v1/organizations/{id}/members` | `organization.members.view` |
| `PATCH, DELETE /api/v1/organizations/{id}/members/{accountId}` | `organization.members.manage` |
| `GET /api/v1/organizations/{id}/members/{accountId}/permissions` | `organization.members.manage` |
| `DELETE /api/v1/organizations/{id}/membership` | `organization.leave`; internal |
| `GET, POST, PATCH, DELETE /api/v1/organizations/{id}/roles` | `organization.roles.view`, `organization.roles.manage` |
| `GET, POST, DELETE /api/v1/organizations/{id}/role-assignments` | `organization.roles.view`, `organization.roles.manage` |
| `GET, POST /api/v1/organizations/{id}/groups` | `organization.groups.view`, `organization.groups.create` |
| `GET, PATCH, DELETE /api/v1/groups/{id}`, members and managers | `group.view`, `group.manage`, `group.delete` |
| `GET, POST, DELETE /api/v1/organizations/{id}/invitations` | `organization.members.manage` |
| `GET, PUT /api/v1/organizations/{id}/settings` | `organization.settings.view`; changes need `organization.settings.manage`, or `organization.signIn.manage` for `auth.*` |
| `POST, DELETE /api/v1/organizations/{id}/break-glass` | `instance.breakGlass.request`, session only; internal |
| `GET /api/v1/instance/organizations`, `.../accounts` | `instance.organizations.view`, `instance.accounts.view` |
| `GET, POST, PATCH, DELETE /api/v1/instance/roles`, `.../role-assignments` | `instance.roles.view`, `instance.roles.manage` |
| `POST /api/v1/instance/ownership` | `instance.ownership.transfer`, recent authentication; internal |
| `GET, PUT /api/v1/instance/settings` | `instance.settings.view`; changes need the area of the setting |
| `POST /api/v1/accounts/{id}/deactivate` | `account.deactivate`, recent authentication; internal |
| `POST /api/v1/invitations/accept` | public, with the token from the mail; internal |
| `POST /api/v1/registrations`, `.../complete` | public; internal |
