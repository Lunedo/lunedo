# Organizations and permissions

An instance contains one or more organizations. Each has its own members, groups, roles and settings. Organizations are invisible to each other: a request for an organization the caller cannot see is answered with `404`, like a request for one that does not exist.

## Organizations

An organization has a name, a slug that is unique regardless of case, a language, a time zone and an optional logo. Language and time zone are organization-level settings, so members inherit them unless they choose their own.

The logo is a PNG, JPEG or WebP image of at most 256 KiB. Lunedo checks that the file content matches the declared type and stores the image in the database, so that backups contain it. Logos are served with their stored type, `nosniff` and a content security policy that forbids any active content. While the instance has exactly one organization, its logo is public, because the sign-in page shows it; otherwise only members of the organization can read it, so the logo cannot be used to find out which organizations exist. The logo reference changes with every upload. The accent color is the setting `branding.accentColor`, one of the seven palette colors, at instance and organization level.

Instance administrators assign e-mail domains to organizations. A domain belongs to at most one organization. When an account is created with a verified address in an assigned domain, through an invitation or self-registration, that organization becomes its home organization.

Self-service creation of organizations is the instance setting `organizations.selfServiceCreation` (default off). When it is on, every active standard account may create organizations, which it then owns. Naming another account as owner needs `instance.organizations.manage`.

## Memberships

A standard account has at most one home organization and is a member of it. The home organization decides two things: whose administrators manage the account itself (second factor, sessions, deactivation), and whose defaults apply to the person's own settings. An account can be a member of further organizations, with a different role in each.

When an account without a home organization becomes a member of an organization for the first time, through a mapping rule or by hand, that organization becomes its home organization (audited as `account.organizationAssigned`). Collaborator and guest memberships never set it. An account that is a member somewhere but has no home organization gets one at its next sign-in or synchronization by the same rule.

| Kind | Who | Limits |
|---|---|---|
| Member | Standard accounts | Holds organization roles |
| Collaborator | Standard accounts of another organization | Sees the organization and what is shared explicitly; holds no organization roles |
| Guest | Guest accounts | Like collaborators; has a responsible person and an optional expiry |

Members see the members of their organizations. Collaborators and guests do not.

Memberships, role assignments and group memberships can expire. Expiry takes effect at the moment it passes, on every node, because every permission check compares it with the database clock. A job removes expired entries every minute and records them in the audit log. The responsible people are reminded by e-mail a configurable number of days before (`organizations.expiryReminderDays`, default 7).

When the mapping rule or the provider group that gave the membership in the home organization no longer applies, that membership ends unless the person holds other access there, and the home organization moves to the next remaining standard membership, the oldest first, or to none. Instance administrators and administrators of the current home organization can also make another organization the account is a member of its home organization (`PUT /api/v1/accounts/{accountId}/home-organization`). Every change is audited as `account.homeOrganizationChanged` in both organizations and notifies the person and the administrators of the old and the new organization (`account.homeOrganizationChanged`).

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
- Every operation that gives or widens access passes one check: assigning a role, adding a member to a group that holds roles, widening a custom role, and creating a token for a service account. What the target gains must be covered by the actor's own permanent permissions; temporary roles and break-glass access never count. A refusal is `selfExtension` when the actor would gain the access, directly, through a group, through a role they hold or through a token they receive, and `roleExceedsOwnPermissions` otherwise.
- Every operation that removes or disables a principal holding a role checks the actor's rank: removing a role or a member, deleting a group or a custom role, deactivating an account or a service account. The actor must hold the areas of what is removed, and only owners remove owners.
- Only owners appoint owners. Owners are individual standard accounts and never expire; service accounts and guests cannot be owners, and the last owner cannot leave or be removed.
- Roles at the instance and organization level, built-in and custom, are assigned only to individual accounts and to groups; instance roles only to accounts. The server refuses all members of an organization and all internal users of the instance with `roleNeedsAccountOrGroup`. These principals remain for content permissions. Assignments made earlier to them stay in effect until they are removed.
- One role can be given to several accounts and groups at once through `POST /api/v1/organizations/{organizationId}/role-assignments/batch` and `POST /api/v1/instance/role-assignments/batch`. Either all assignments are made or none.

## Groups

Groups belong to an organization and contain members of it. A group may have a single member. Groups are not nested. Organization administrators create groups; members can when the organization setting `organizations.membersCreateGroups` is on. The creator becomes the first group manager and can add further managers. Adding someone to a group that holds roles requires the right to assign those roles.

## Invitations and self-registration

Invitations go by e-mail, are valid for 7 days, work once and are stored as hashes. Accepting an invitation creates the account, with a verified address, or adds the membership to the existing account with that address. Collaborators join with their existing account. An invitation can carry a role up to the inviter's level.

Self-registration is the setting `organizations.selfRegistration` (default off). When an organization enables it, people with an address in one of its domains receive a confirmation link and create their account themselves. The answer to a registration request is the same whether it is accepted or not.

## Break-glass access

An instance administrator can request access to an organization with a reason. The access gives the organization administrator role, never more, for `organizations.breakGlassMinutes` (default 240) and ends early when the requester ends it or loses the instance role that allowed the request. The organization's owners receive an e-mail at once. Start, every permitted action and the end are recorded in the organization's audit log.

## Authorization service

The authorization service is the only place that decides whether a principal may perform an action on a resource. Resource types register their actions: each action names the area and level that grant it, membership kinds that grant it, or a rule, such as group managers managing their group. Every API route declares its action with `@Permission(...)`; the global guard asks the service before the handler runs.

Principals are accounts, including service accounts, groups, all members of an organization, all internal users, anonymous and system. A request with an API token is limited further by the token's scopes, see [api.md](api.md). Decisions are computed per request and cached only for the length of a request, so a change of roles, memberships or account state takes effect on the next request on every node.

`explain` returns why a principal has or lacks a permission: the role, how it is held (directly, through a group, through all members, through break-glass access) and, when denied, the reason, for example `notMember`, `limitedMembership`, `noRoleGrantsArea`, `ownerOnly`, `instanceRolesDoNotGrantOrganizationAccess` or `tokenScope`.

A permission matrix test generates every combination of account kind, principal kind, built-in role, a custom role per area and registered action, and compares each decision with a model of the rules. New actions and roles are covered without changing the test; an action with a rule the model does not know fails it.

## Account administration

`GET /api/v1/instance/accounts` lists accounts with their instance roles, whether a second factor is set up and the last sign-in; `GET /api/v1/instance/accounts/{id}` adds the memberships and roles per organization, active sessions, active personal API tokens and the second factors. `GET /api/v1/instance/organizations` lists organizations with their owners, number of members and domains. These lists, the members and the groups of an organization accept `q` to search names, e-mail addresses, short names and group descriptions on the server, page by page.

Administrators deactivate and reactivate accounts, end all sessions of an account and reset its second factor. Instance administrators with the accounts area may do this for every account, administrators of an organization for accounts whose home organization it is. The same rank rules apply to all four actions: holders of instance roles need someone with at least the same instance areas, owners of an organization, their home organization or any other, need an owner of that organization or the instance owner, the instance owner needs an owner, and nobody acts on their own account this way. Ending sessions and reactivating are audited as `account.sessionsEnded` and `account.reactivated`.

## Placeholders and anonymization

A placeholder stands for a person who has no account yet, for example the author of imported content. Instance administrators create placeholders with a name and an e-mail address (`POST /api/v1/instance/accounts/placeholders`, audited as `account.placeholderCreated`); imports will create them as well. A placeholder cannot sign in. When the person signs in through a provider for the first time with that address, and the address is verified because its domain belongs to the provider, the placeholder becomes their account under the same rules as an account created at sign-in; it keeps its memberships, groups and roles. An address that is not verified never takes over a placeholder. Otherwise instance administrators merge the placeholder into an existing account (`POST /api/v1/instance/accounts/{placeholderId}/merge`, with a recent confirmation of identity): its memberships, group memberships and organization roles move to the account, and the placeholder points to it. The merged placeholder loses its name and address, and its audit entries belong to the account from then on. Nobody can merge a placeholder into their own account. Both ways are audited as `account.placeholderMerged`.

Instance administrators anonymize accounts in the account panel (`POST /api/v1/instance/accounts/{accountId}/anonymize`) with a recent confirmation of identity, a reason and the name of the account typed to confirm. Anonymization cannot be undone. It removes the name, e-mail address, sign-in names and profile; the account shows as "Former user" with the first characters of its ID. Identities, sessions, API tokens, passkeys, second factors, recovery codes, notifications and personal settings are deleted, and all memberships, roles and group memberships end. Content keeps the pseudonym. The audit log keeps the events of the account but can no longer show its personal data (see [audit.md](audit.md)), including the data of placeholders merged into it and of invitations to its address or to the addresses of its identities, also after old invitations were removed. Refused sign-ins under those identities are deleted as well; copies exported or streamed before are outside Lunedo. The instance owner, the last owner of an organization and the own account cannot be anonymized, and accounts with instance roles only by the instance owner. Anonymization is audited as `account.anonymized`.

## Endpoints

Each endpoint declares the action it requires. Endpoints marked internal serve the web client and are left out of the public API reference; the others are described at `/api/docs`, see [api.md](api.md).

| Endpoint | Action |
|---|---|
| `GET /api/v1/organizations` | session: organizations of the caller; internal |
| `POST /api/v1/organizations` | `instance.organizations.create` |
| `GET, PATCH /api/v1/organizations/{id}` | `organization.view`, `organization.update` |
| `PUT, DELETE /api/v1/organizations/{id}/logo` | `organization.update` |
| `GET /api/v1/organizations/{id}/logo` | `organization.view`, public while the instance has one organization; internal |
| `GET /api/v1/organizations/{id}/domains` | `organization.signIn.view` |
| `POST, DELETE /api/v1/organizations/{id}/domains` | `instance.organizations.manage` |
| `GET /api/v1/organizations/{id}/members` | `organization.members.view` |
| `PATCH, DELETE /api/v1/organizations/{id}/members/{accountId}` | `organization.members.manage` |
| `GET /api/v1/organizations/{id}/members/{accountId}/permissions` | `organization.members.manage` |
| `DELETE /api/v1/organizations/{id}/membership` | `organization.leave`; internal |
| `GET, POST, PATCH, DELETE /api/v1/organizations/{id}/roles` | `organization.roles.view`, `organization.roles.manage` |
| `GET, POST, DELETE /api/v1/organizations/{id}/role-assignments` | `organization.roles.view`, `organization.roles.manage` |
| `POST /api/v1/organizations/{id}/role-assignments/batch` | `organization.roles.manage`; internal |
| `GET, POST /api/v1/organizations/{id}/groups` | `organization.groups.view`, `organization.groups.create` |
| `GET, PATCH, DELETE /api/v1/groups/{id}`, members and managers | `group.view`, `group.manage`, `group.delete` |
| `GET, POST, DELETE /api/v1/organizations/{id}/invitations` | `organization.members.manage` |
| `GET /api/v1/organizations/{id}/settings` | `organization.settings.view` |
| `PUT /api/v1/organizations/{id}/settings/{key}` | `organization.settings.manage`, or `organization.signIn.manage` for `auth.*` |
| `POST, DELETE /api/v1/organizations/{id}/break-glass` | `instance.breakGlass.request`, session only; internal |
| `GET /api/v1/instance/organizations`, `.../accounts` | `instance.organizations.view`, `instance.accounts.view` |
| `GET, POST, PATCH, DELETE /api/v1/instance/roles`, `.../role-assignments` | `instance.roles.view`, `instance.roles.manage` |
| `POST /api/v1/instance/role-assignments/batch` | `instance.roles.manage`; internal |
| `GET /api/v1/instance/accounts/{id}` | `instance.accounts.view`; internal |
| `POST /api/v1/instance/ownership` | `instance.ownership.transfer`, recent authentication; internal |
| `GET /api/v1/instance/info` | public: instance name, defaults and the only organization; internal |
| `GET /api/v1/instance/break-glass` | `instance.organizations.view`; internal |
| `GET /api/v1/instance/mail` | `instance.settings.view`; internal |
| `PUT /api/v1/instance/mail` | `instance.settings.manage`, recent authentication; internal |
| `POST /api/v1/instance/mail/test` | `instance.settings.manage`; internal |
| `GET /api/v1/instance/settings` | `instance.settings.view` |
| `PUT /api/v1/instance/settings/{key}` | the `manage` permission of the setting's area: settings, sign-in, audit log or organizations |
| `GET /api/v1/account/permissions` | session: the actions the caller may perform on the instance and one organization; internal |
| `GET, PUT /api/v1/account/preferences` | session: the caller's settings at the user level; internal |
| `POST /api/v1/accounts/{id}/deactivate` | `account.deactivate`, recent authentication; internal |
| `POST /api/v1/accounts/{id}/reactivate` | `account.reactivate`, recent authentication; internal |
| `POST /api/v1/accounts/{id}/sessions/end` | `account.sessions.end`, recent authentication; internal |
| `POST /api/v1/accounts/{id}/second-factor/reset` | `account.secondFactor.reset`, recent authentication; internal |
| `GET /api/v1/accounts/{id}/security-activity` | `account.activity.view`, only the own account; internal |
| `POST /api/v1/invitations/accept` | public, with the token from the mail; internal |
| `POST /api/v1/registrations`, `.../complete` | public; internal |
