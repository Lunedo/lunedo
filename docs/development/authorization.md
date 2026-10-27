# Authorization

The authorization service (`packages/server/src/authorization/service.ts`) is the only place that decides whether a principal may perform an action on a resource. No route, job or service checks permissions on its own. The rules administrators see are described in [Roles and permissions](../admin/roles-and-permissions.md); this page covers how the code implements them.

## Resource types and actions

Resource types register in the `AuthorizationRegistry` (`packages/server/src/authorization/registry.ts`, types in `resources.ts`). Each type lists its actions, and each action names what grants it:

- an area and a level, at the instance, organization or space scope, for example `organization.members.manage` needs the organization area `membersAndGroups` with `manage`;
- membership kinds that grant it, for example `organization.view` for every kind of membership;
- a space role for space actions;
- a rule, a named function of the type, such as group managers managing their group or `membersCreateSpaces` reading the organization setting;
- flags such as `ownerOnly`, `breakGlass` (break-glass access may use it) and `tokenScope` (which token scope covers it).

The registry refuses inconsistent definitions at startup: an action whose name does not start with its type, an action registered twice, an unknown rule or restriction, an organization action on a type without `organizationOf`, a space action without `spaceOf`, or an area without a level. New features add resource types and actions; they do not change the service.

## Routes

Every API route declares its access with one decorator from `apps/api/src/access/route-access.ts`, and the global guard enforces it before the handler runs:

| Decorator | Meaning |
|---|---|
| `@Permission(action, resource, options)` | The action on the resource taken from a route parameter or the instance. Several actions mean any of them. Options: `recentAuthentication`, `sessionOnly` (API tokens are refused), `publicForSoleOrganization`. |
| `@SessionRoute(options)` | Any signed-in session; options for second factor setup, recent authentication and portal accounts. |
| `@PublicRoute()` | No authentication. |
| Others | Setup code, setup session, metrics token, SCIM token and the API documentation. |

`@InternalRoute()` marks a route that serves the web client. Internal routes are left out of the reference at `/api/docs`; the committed `apps/api/openapi.json` keeps them, marked with `x-lunedo-internal`. The API refuses to start when a route declares no access, and the guard denies such a route.

## Principals

Principals are accounts (including service accounts and portal accounts), groups, all members of an organization, all internal users of the instance, anonymous and system. Role assignments at the instance and organization level take only accounts and groups; the two collective principals exist for space roles and other content permissions.

A request with an API token is limited further by the token's scopes: the areas of every held role are intersected with what the token allows (`#limitRoles`). See [API authentication](../api/authentication.md).

## Facts and caching

Decisions are computed from facts loaded from the database: the account's state and type, memberships, groups, managed groups and held roles with how they are held (directly, through a group, through all members, through break-glass access). Facts are cached only for the length of one request (`cached` in `facts.ts`, keyed in the request context), so a change of roles, memberships or account state takes effect on the next request on every node. Expiry is compared with the database clock.

Break-glass access adds the organization administrator role while the access is active and the requester still holds the instance area `organizations` with `manage`. Every action allowed only through break-glass access records `breakGlass.actionAuthorized` in the organization's audit log.

## Grant and rank checks

Two checks protect the role model:

- `checkGrant` runs before every operation that gives or widens access. What the target gains must be covered by the actor's permanent roles: roles with an expiry and break-glass roles are left out. It denies with `selfExtension` when the actor would gain the access themselves, `roleExceedsOwnPermissions` otherwise, and `ownerOnly` for owner grants.
- `checkRank` runs before every operation that removes or disables a principal holding a role. The actor must hold the areas of what is removed; owners need an owner who is not one through break-glass access. `checkRankOverAccount` and `checkOwnersOverAccount` apply it to accounts; `packages/server/src/accounts/administration.ts` combines them with the instance-level checks for the account actions.

## Explaining decisions

`explain` returns why a principal has or lacks a permission: the grants, with the role and how it is held, and, when denied, the reasons. The denials are listed in `denials` in `service.ts`, among them `anonymous`, `accountInactive`, `resourceNotFound`, `notMember`, `limitedMembership`, `noRoleGrantsArea`, `ownerOnly`, `instanceRolesDoNotGrantOrganizationAccess`, `roleExceedsOwnPermissions`, `selfExtension`, `noSpaceRole`, `tokenScope` and `ruleNotMet`, plus the restriction denials. The member page uses it for **Explain permissions** (`GET /api/v1/organizations/{organizationId}/members/{accountId}/permissions`).

## Permission matrix test

The matrix tests (`packages/server/src/authorization/matrix-*.test.ts`, shared code in `matrix.testing.ts`) generate every combination of subject (member, service account, collaborator, guest, deactivated account, non-member), principal kind, built-in role, a custom role per area and registered action, and compare each decision with a model of the rules. New actions and roles are covered without changing the test; an action with a rule the model does not know fails it.

## Internal routes

These routes of organizations and accounts serve the web client and are not in `/api/docs`. The public routes are described in [Organizations API](../api/organizations.md).

| Route | Access |
|---|---|
| `GET /api/v1/organizations` | Session: the caller's organizations |
| `GET /api/v1/organizations/{organizationId}/logo` | `organization.view`; public while the instance has one organization |
| `DELETE /api/v1/organizations/{organizationId}/membership` | `organization.leave` |
| `POST /api/v1/organizations/{organizationId}/role-assignments/batch` | `organization.roles.manage`; all assignments or none |
| `POST /api/v1/organizations/{organizationId}/break-glass` | `instance.breakGlass.request`, recent authentication |
| `DELETE /api/v1/organizations/{organizationId}/break-glass/{accessId}` | `instance.breakGlass.request`, session only |
| `GET /api/v1/instance/info` | Public: instance name, defaults and the only organization |
| `GET /api/v1/instance/break-glass` | `instance.organizations.view`: break-glass accesses of the last 90 days |
| `GET /api/v1/instance/accounts/{accountId}` | `instance.accounts.view` |
| `POST /api/v1/instance/role-assignments/batch` | `instance.roles.manage` |
| `POST /api/v1/instance/ownership` | `instance.ownership.transfer`, recent authentication |
| `GET, PUT /api/v1/instance/address` | `instance.settings.view`, `instance.settings.manage` with recent authentication |
| `GET /api/v1/instance/mail` | `instance.settings.view` |
| `PUT /api/v1/instance/mail`, `PUT .../mail/method`, `PUT .../mail/graph` | `instance.settings.manage`, recent authentication |
| `POST /api/v1/instance/mail/test`, `POST .../mail/graph/test` | `instance.settings.manage`, recent authentication |
| `POST, DELETE /api/v1/instance/mail/graph/credentials[/{credentialId}]` | `instance.settings.manage`, recent authentication |
| `GET /api/v1/instance/mail/graph/credentials/{credentialId}/certificate` | `instance.settings.view` |
| `GET /api/v1/account/permissions` | Session: the actions the caller may perform on the instance and one organization |
| `GET /api/v1/account/preferences`, `PUT .../preferences/{key}` | Session: the caller's settings at the user level |
| `GET /api/v1/accounts/{accountId}/picture` | Session |
| `POST /api/v1/accounts/{accountId}/deactivate` | `account.deactivate`, recent authentication |
| `POST /api/v1/accounts/{accountId}/reactivate` | `account.reactivate`, recent authentication |
| `POST /api/v1/accounts/{accountId}/sessions/end` | `account.sessions.end`, recent authentication |
| `POST /api/v1/accounts/{accountId}/sessions/{sessionId}/end` | `account.sessions.end`, recent authentication |
| `POST /api/v1/accounts/{accountId}/second-factor/reset` | `account.secondFactor.reset`, recent authentication |
| `PUT /api/v1/accounts/{accountId}/home-organization` | `account.homeOrganization.change` |
| `POST /api/v1/invitations/preview`, `.../accept` | Public, with the token from the mail |
| `POST /api/v1/registrations`, `.../complete` | Public |

The `account.*` actions are granted by the instance area `accounts` with `manage` or by the rule `homeOrganizationAdministrator` (Members and groups with Manage in the account's home organization); the services add the rank checks described above.
