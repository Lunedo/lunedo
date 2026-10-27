# Roles and permissions

Administrative permissions in Lunedo are grouped into areas. A role gives each area **View** or **Manage**; Manage includes View. Instance roles are managed under **Settings › Instance › People and sign-in › Roles**, organization roles under **Settings › Organization › People and access › Roles**. Permissions on content come from space roles, shares and restrictions instead, see [Spaces and pages](../user/spaces-and-pages.md) and [Sharing and restrictions](../user/sharing-and-restrictions.md).

## Areas

| Instance area | Covers |
|---|---|
| Organizations | Creating organizations and break-glass access |
| Accounts | All accounts and instance roles |
| Sign-in and security | Sign-in rules for everyone |
| Settings | Instance settings and the mail server |
| Operations | System status, backups and updates |
| Audit log | Reading and exporting the instance audit log |

| Organization area | Covers |
|---|---|
| Members and groups | Invitations, members, groups and roles |
| Spaces | Creating and administering spaces |
| Settings | Organization settings and defaults |
| Sign-in and security | Sign-in rules and domains |
| Integrations and API | Service accounts and API tokens |
| Audit log | Reading and exporting the audit log |

## Built-in roles

Built-in roles use the same areas as custom roles:

| Role | Level | Areas |
|---|---|---|
| Owner | Instance | All instance areas: Manage. Exactly one; only the owner transfers ownership, after confirming their identity, to an active instance administrator whose account is not managed by an identity provider. |
| Administrator | Instance | All instance areas: Manage |
| Security auditor | Instance | All instance areas: View |
| Owner | Organization | All organization areas: Manage. At least one; the last owner cannot leave or be removed. |
| Administrator | Organization | All organization areas: Manage. Cannot manage owners. |
| Member | Organization | Members and groups: View. Every member has this role. |

Custom roles choose View, Manage or nothing per area. Changing a custom role changes the permissions of everyone holding it at once.

## Rules

- Instance roles never grant access to organizations. An instance administrator who is not a member sees an organization only through [break-glass access](organizations.md#break-glass-access).
- Roles at the instance and organization level, built-in and custom, go only to individual accounts and to groups; instance roles only to standard accounts. All members of an organization and all internal users of the instance cannot receive them (`roleNeedsAccountOrGroup`). These principals exist for content permissions only.
- Organization roles go to members only. Collaborators and guests have fixed limits and hold no organization roles.
- Owners are individual standard accounts and never expire; their membership cannot expire either. Service accounts and guests cannot be owners, and the last owner cannot leave or be removed. Only owners appoint owners.
- A role can be given to several people and groups at once. Either all assignments are made or none.
- Giving, removing and changing roles is recorded in the audit log, see [Audit log](audit-log.md).

## Giving access

Every operation that gives or widens access passes one check: giving a role, adding a member to a group that holds roles, widening a custom role, and creating a token for a service account. What the target gains must be covered by the actor's own permanent permissions. Roles with an expiry and break-glass access never count.

| Refusal | When |
|---|---|
| `selfExtension` | The actor would gain the access themselves, directly, through a group, through a role they hold or through a token they receive. |
| `roleExceedsOwnPermissions` | The actor does not hold what they try to give. |
| `ownerOnly` | Only an owner may do this, for example appoint another owner. |

The role dialogs show this before saving: an area the actor does not hold cannot be granted.

## Who may act on whom

Every operation that removes or disables a principal holding a role checks the actor's rank: removing a role or a member, deleting a group or a custom role, deactivating an account or a service account. The actor must hold the areas of what is removed, and only owners remove owners.

The account actions (deactivate, reactivate, end sessions, reset the second factor, link or unlink sign-in identities) follow these rules. Changing the home organization follows them too, except the row for the own account: administrators can change their own home organization. They are available to instance administrators with the area Accounts and Manage, and to administrators with Members and groups and Manage in the account's home organization.

| Target account | Who may act on it |
|---|---|
| The own account | Nobody through these actions. People manage their own sessions and second factor under **Settings › My account › Sign-in and security**. |
| The instance owner | Nobody. The instance owner cannot be deactivated or anonymized; ownership must be transferred first. |
| An account with an instance role | Someone with at least the same instance areas. Deactivating and anonymizing it: only the instance owner. |
| An owner of any organization | An owner of that organization, or the instance owner. |
| Any other account | Instance administrators with Accounts and Manage, or administrators of its home organization who hold at least the target's areas there. |

All rows apply together: an account that holds an instance role and owns an organization needs an actor who passes both rows.

Deactivation is also refused when the account is the last owner of an organization.
