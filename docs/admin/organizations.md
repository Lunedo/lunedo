# Organizations

An instance contains one or more organizations. Each has its own members, groups, roles and settings. Organizations are invisible to each other: a request for an organization the caller cannot see is answered with `404`, like a request for one that does not exist.

This page explains how organizations, memberships, guests, groups, invitations and break-glass access work. Who may do what is on [Roles and permissions](roles-and-permissions.md); managing single accounts is on [Accounts](accounts.md).

## Organizations

An organization has a name, a slug that is unique regardless of case, a language, a time zone and an optional logo. Name, slug, logo and the defaults for language, time zone and formats are under **Settings › Organization › General**. Language and time zone are organization-level settings, so members inherit them unless they choose their own.

The logo is a PNG, JPEG or WebP image of at most 256 KiB. Lunedo checks that the file content matches the declared type and stores the image in the database, so that backups contain it. While the instance has exactly one organization, its logo is public, because the sign-in page shows it; otherwise only members of the organization can read it, so the logo cannot be used to find out which organizations exist. The accent color is the instance setting `branding.accentColor` under **Settings › Instance › General**; organizations do not have their own.

Instance administrators create organizations under **Settings › Instance › People and sign-in › Organizations** and assign e-mail domains to them. A domain belongs to at most one organization. When an account is created with a verified address in an assigned domain, through an invitation or self-registration, that organization becomes its home organization. Organization administrators see the domains under **Settings › Organization › People and access › Domains and guests**, but only instance administrators add or remove them.

Self-service creation of organizations is the instance setting **Self-service organizations** (`organizations.selfServiceCreation`, default off) under **Settings › Instance › People and sign-in › Policies**. When it is on, every active standard account may create organizations, which it then owns. Naming another account as owner needs the instance area Organizations with manage.

## Memberships

A standard account has at most one home organization and is a member of it. The home organization decides two things: whose administrators manage the account itself (second factor, sessions, deactivation), and whose defaults apply to the person's own settings. An account can be a member of further organizations, with a different role in each.

When an account without a home organization becomes a member of an organization for the first time, through a mapping rule or by hand, that organization becomes its home organization. Collaborator and guest memberships never set it. An account that is a member somewhere but has no home organization gets one at its next sign-in or synchronization by the same rule. How the home organization changes later is described in [Accounts](accounts.md#home-organization).

| Kind | Who | Limits |
|---|---|---|
| Member | Standard accounts | Holds organization roles |
| Collaborator | Standard accounts of another organization | Sees the organization and what is shared explicitly; holds no organization roles |
| Guest | Guest accounts | Like collaborators; has a responsible person and an optional expiry |

Members see the members of their organizations. Collaborators and guests do not.

Memberships, role assignments and group memberships can expire. Expiry takes effect at the moment it passes, on every node, because every permission check compares it with the database clock. A job removes expired entries every minute and records them in the audit log. The people responsible are reminded before the end (**Access expiry reminder**, `organizations.expiryReminderDays`).

An account cannot leave its home organization; deactivate it instead, see [Accounts](accounts.md#deactivating-and-reactivating).

### Guests

A guest has a responsible person, by default the person who invited them. The responsible person is reminded before the guest's access expires and is told when the guest has not been active for a while. When the responsible person leaves or is deactivated, the organization's owners and administrators take over.

The reminder periods are under **Settings › Organization › People and access › Domains and guests**, section **Guests and expiry**.

They are **Guest expiry reminder**, **Inactive guests** and **Access expiry reminder**, in days. The [Settings reference](settings-reference.md#organization--people-and-access--domains-and-guests) lists their keys, defaults and allowed values.

All three are organization settings and can be locked for members.

## Roles

Organization roles group permissions into areas such as Members and groups or Spaces. Roles go to individual accounts and to groups, never to all members at once. The areas, built-in roles and the rules for giving and removing roles are on [Roles and permissions](roles-and-permissions.md).

## Groups

Groups belong to an organization and contain members of it. A group may have a single member. Groups are not nested. They are managed under **Settings › Organization › People and access › Groups**.

Administrators with the area Members and groups create groups. Members can create groups when **Members create groups** (`organizations.membersCreateGroups`, default off) is on under **Settings › Organization › People and access › Domains and guests**. The creator becomes the first group manager and can add further managers. Adding someone to a group that holds roles requires the right to give those roles.

Groups can also come from an identity provider, see [Identity provider groups](identity-provider-groups.md).

## Invitations and self-registration

Invitations go by e-mail, are valid for 7 days, work once and are stored as hashes. Accepting an invitation creates the account, with a verified address, or adds the membership to the existing account with that address. Collaborators join with their existing account. An invitation for a member can carry a role up to the inviter's own permissions; invitations for guests and collaborators carry none.

When the domain of the invited address belongs to an identity provider, the invitation page asks only for the name. The account is created without a password, is managed by that provider, and the page offers **Continue with** *provider*; the first sign-in there links the account (see [Identity providers](identity-providers.md#managed-accounts)). Portal invitations for readers of a knowledge base always ask for a password.

Self-registration is the setting **Self-registration** (`organizations.selfRegistration`, default off) under **Settings › Organization › People and access › Domains and guests**. When an organization enables it, people with an address in one of its domains receive a confirmation link and create their account themselves. The answer to a registration request is the same whether it is accepted or not, except for addresses in a domain of an identity provider: they are refused with `managedDomain`, and the page says to sign in through that provider instead. A registration link opened after the domain was assigned to a provider is refused the same way.

## Break-glass access

Break-glass access is called **Emergency access to organizations** in the interface (**Settings › Instance › People and sign-in › Emergency access to organizations**). It lets an instance administrator act in an organization they do not belong to, for emergencies. Instance roles alone never grant access to organizations.

To request it:

1. Open **Settings › Instance › People and sign-in › Emergency access to organizations**.
2. Select **Request break-glass access** and choose the organization.
3. Enter a reason of 10 to 2000 characters. The owners of the organization see it.
4. Confirm your identity when Lunedo asks for it.

The access gives the organization administrator role, never more. It lasts for **Break-glass duration** (`organizations.breakGlassMinutes`, instance setting, default 240 minutes, 5 to 1440 minutes) and ends early when the requester selects **End access** or no longer holds the instance area Organizations with manage. The organization's owners are notified at once (event **Break-glass access started**). The start, every action allowed through the access and the end are recorded in the organization's audit log, see [Audit log](audit-log.md).

Break-glass access never counts for giving access to others: a role given or widened through it is refused, and only owners who are owners by assignment can act on owners. The page lists the break-glass accesses of the last 90 days.

How the instance owner signs in when identity providers fail is a different mechanism, the emergency sign-in, see [Emergency sign-in](identity-providers.md#emergency-sign-in).
