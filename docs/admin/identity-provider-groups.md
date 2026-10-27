# Identity provider groups

Groups at an identity provider decide what people get in Lunedo. Mapping rules turn membership in a provider group into membership in an organization, a role, membership in a synchronized Lunedo group, or an instance role. Rules apply at every sign-in, at every synchronization and with every SCIM request.

How a provider is set up is described in [Identity providers](identity-providers.md) and on the page of each method.

## Groups

Lunedo identifies a group by its stable ID at the provider, never by its name. It stores the names it sees and updates them when the provider renames a group; rules keep working.

| Method | Where the groups come from |
|---|---|
| Microsoft Entra ID | Object IDs from the token or assertion; names, overage and nested groups through Microsoft Graph. See [Microsoft Entra ID](identity-providers/entra-id.md#groups). |
| Google Workspace | Only with group synchronization, through the Directory API. See [Google Workspace](identity-providers/google-workspace.md#group-synchronization). |
| Other OIDC providers | A configurable claim in the ID token. See [OpenID Connect](identity-providers/openid-connect.md#groups). |
| ADFS and other SAML providers | A configurable attribute of the assertion, with identifiers or names. See [SAML](identity-providers/saml.md). |
| LDAP and Active Directory | The directory, including nested groups. See [LDAP and Active Directory](identity-providers/ldap.md). |

Where a provider sends group names instead of IDs, renaming a group at the provider breaks the rules for it until they are changed in Lunedo. The rule list and the rule dialog warn about this.

When a provider that sent a groups claim or attribute before stops sending it, instance administrators see a banner with the provider and the date. Lunedo then treats everyone signing in as having no groups and removes the access and roles that came from groups. Check the groups setting of the provider, in Lunedo and at the provider. The banner disappears with the next sign-in that carries groups, or when the groups setting changes.

When groups cannot be read at sign-in, for example because Microsoft Graph or the directory is not reachable, the person is signed in with the groups Lunedo knew before.

## Mapping rules

Mapping rules are on the provider page, tab **Group mapping**. A rule maps a group of the provider to one of:

- **Organization access**: membership in an organization, optionally with a role, optionally also adding the members to a synchronized group in Lunedo, and optionally making the organization the home organization.
- **Instance role**: a role for the whole instance. Instance roles never grant access to the content of organizations. Only rules of providers grant instance roles; groups of organizations in Lunedo can never receive them.

To add a rule:

1. Choose **Add rule**.
2. Choose the group. The dialog suggests the groups Lunedo has seen at sign-ins and synchronizations, with their names where known. For providers with a directory (Entra ID through Graph, Google Workspace with group synchronization, LDAP and Active Directory), it also searches the directory by name and stores the ID of the chosen group; a value that is not a group of the directory is refused. For other providers, type the value exactly as the provider sends it, then choose **Use this text as group value**.
3. Choose what the rule grants.
4. Check the preview (see below) and save.

Rules behave as follows:

- Creating, changing, reordering and removing a rule is a grant. For organization access, you must be allowed to manage the members of the organization and to grant the chosen role yourself. For an instance role, you must be allowed to grant that role. The instance owner is not a role and cannot be granted.
- Several rules add up.
- When someone leaves a group, Lunedo removes exactly what the rules granted. Access granted by hand stays, and a membership stays while the person holds other access in the organization.
- When the membership that ends was the home organization, the home organization moves to the next remaining standard membership, or to none.
- **Make this organization the home organization** is only needed when rules lead into several organizations. Otherwise the first organization an account joins becomes its home organization. When several rules name a home organization, the first in rule order decides. Use **Move up** and **Move down** to change the order.
- A rule whose group no longer exists at the provider grants nothing, is marked "Group not found" in the list and produces a warning in the sync log.
- **Remove rule**: members of the group lose what this rule granted at their next sign-in or synchronization. Access granted by hand stays.

Every change of a rule, and every membership, role and group membership a rule grants or withdraws, is recorded in the [audit log](audit-log.md) and can be found there with the filter.

### Group preview

Before saving, the rule dialog shows who gains access through the group: how many people become members of the organization or receive the instance role, how many of them have an account already, and how many get one at their next sign-in. The number of members at the provider is known for Entra ID (with SAML only when Microsoft Graph access is set up) and for Google Workspace with group synchronization; otherwise, the preview counts the accounts Lunedo has seen in the group.

## Synchronized groups

With **Also add the members to a synchronized group in Lunedo**, the rule creates a group in the organization with the name of the provider group. Synchronized groups are read-only in Lunedo: members, managers, name and description come from the provider, and the group shows which provider manages it. Their permissions in Lunedo can still be changed.

When the provider renames the group, the synchronized group follows at the next sign-in or synchronization. If the name is taken in the organization, the provider's name is added in parentheses, for example "engineering (Keycloak)". Renames appear in the sync log with the old and the new name.

When the provider is removed, its synchronized groups become ordinary groups with their members and permissions.

## Synchronization

Providers with a directory are synchronized in the background:

- Microsoft Entra ID through OIDC;
- Microsoft Entra ID through SAML with Graph access;
- Google Workspace with group synchronization and a service account key;
- LDAP and Active Directory.

Other providers update their accounts at every sign-in. A synchronization run updates the profiles and groups of linked accounts, applies the mapping rules, follows renamed groups, marks deleted ones, and deactivates accounts the provider disabled or deleted.

The settings are on the provider page, tab **Settings**, under **Synchronization**:

| Setting | Default | Range |
|---|---|---|
| Sync interval | 60 minutes | 15 to 1440 minutes |
| Largest share deactivated at once | 20 % | 1 to 100 % |
| Accounts a run may always deactivate | 5 | 0 to 100,000 |

**Sync now** on the tab **Sync log** starts a run at once. Only one run per provider happens at a time, on any number of nodes. Runs are background jobs; requests to Microsoft Graph and Google have a timeout of 10 seconds each. A run that sends no sign of life for five minutes counts as aborted, and the next run can start.

A running synchronization can be stopped with **Cancel run** in the sync log. It stops before the next account, keeps the changes made so far and is shown as cancelled.

While [SCIM](scim.md) is on, the background synchronization runs once a day as a reconciliation instead of at its interval.

### Deactivated accounts

An account that the provider disabled or deleted is deactivated in Lunedo: its sessions end and its personal API tokens are revoked for good. Lunedo never deletes accounts. When the provider enables the account again, Lunedo reactivates it, but only if this provider deactivated it.

A wrong search base, a moved directory unit or a service account that lost its read permission look the same as everyone leaving. So a run stops when it would deactivate more than **Largest share deactivated at once** of the provider's active accounts and more than **Accounts a run may always deactivate**, or when it finds none of the linked accounts. Such a run deactivates nobody, ends as failed with a warning, and the instance owner and administrators get a notification.

1. Check the provider first: the search base, the directory unit and the permissions of the service account or app registration.
2. If the people really left, open the run in the sync log and choose **Confirm deactivations**.

Confirming starts a new run that may deactivate up to as many accounts as the held one. Each held run can be confirmed once.

### Sync log

The tab **Sync log** lists every run with its start, trigger (Schedule, Manual, SCIM, Reconciliation or Sign-in), result, changes and duration. The filter shows all runs, runs with changes or failed runs. A run shows its changes, warnings and, when it failed, why. A run that cannot store its result ends as failed.

The sync log and the screens that show groups, members and accounts update without a reload when a run starts, is cancelled or ends.

Runs are kept for the instance setting **Keep synchronization logs for**, 90 days by default (7 to 3650), in **Settings › Instance › People and sign-in › Policies** under **Retention**.

## Paused roles

When the groups of a person cannot be read, at sign-in or during a synchronization, memberships stay as last known. When the last successful read is older than twice the provider's sync interval, Lunedo pauses the instance roles and the organization roles owner and administrator that come from mapping rules: permission checks no longer count them.

The person sees which roles are paused and why. Instance administrators get a notification once. The roles return with the next successful read of the groups, for example at the next sign-in.
