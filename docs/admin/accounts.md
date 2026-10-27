# Accounts

Instance administrators manage every account under **Settings › Instance › People and sign-in › Accounts**. Administrators of an organization deactivate accounts whose home organization it is with **Deactivate account** in the member list under **Settings › Organization › People and access › Members**. Which administrator may act on which account is described in [Roles and permissions](roles-and-permissions.md#who-may-act-on-whom).

## Account types and states

| Type | Used for |
|---|---|
| Standard | People in an organization |
| Guest | People outside the organization who see only what is shared with them |
| Portal | Readers of a knowledge base portal, see [Knowledge base access](../user/knowledge-base-access.md) |
| Service | Scripts and integrations that act only through API tokens, see [Service accounts](service-accounts.md) |

An account is **Invited**, **Active**, **Deactivated**, **Anonymized** or a **Placeholder**.

## Finding accounts

The account list shows each account with its type, state, home organization, instance role, whether a second factor is set up and the last sign-in. The search matches names, e-mail addresses and short names on the server, page by page. The filter offers accounts without organization and, for instance administrators, personal spaces that wait for review (see [Spaces](spaces.md#personal-spaces)).

The account page adds the memberships and roles per organization, active sessions, active API tokens, the second factors and, under **Activity**, the account's entries in the instance audit log.

## Home organization

The home organization decides whose administrators manage the account and whose defaults apply to the person's own settings. How an account gets its first home organization is described in [Organizations](organizations.md#memberships).

The home organization changes in these cases:

- **A mapping rule or provider group no longer applies.** The membership that came from it ends unless the person holds other access there. The home organization moves to the next remaining member organization, the oldest membership first, or to none.
- **An administrator changes it.** Instance administrators and administrators of the current home organization can make another organization the home organization, as long as the account is a member there. The rank rules of [Who may act on whom](roles-and-permissions.md#who-may-act-on-whom) apply: the home organization of an organization owner or of an account with an instance role is changed only by someone who passes the rows of that table for it. On the account page under **Settings › Instance › People and sign-in › Accounts**, open **Home organization** and select **Change home organization**. When the person is a member of only one organization, add them as a member to another organization first.
- **The account has no organization.** Accounts listed under the filter **Without organization**, for example after a first sign-in through a provider whose rules matched no organization, get one through **Assign organization** on the account page. The account becomes a member of it.

Every change notifies the person and the administrators of the old and the new organization (event **Home organization changed**) and is recorded in the audit log of both organizations.

## Deactivating and reactivating

An account cannot leave its home organization; deactivate it instead. Deactivation stops every sign-in, ends all sessions at once and revokes the account's API tokens for good. The instance owner, the last owner of an organization and the own account cannot be deactivated.

On the account page, the danger zone offers:

| Action | Effect |
|---|---|
| **End all sessions** | Signs the person out on every device. They can sign in again right away. Single sessions can be ended under **Sign-in and security**. |
| **Reset second factor** | Removes the authenticator app, passkeys and recovery codes and ends every session. The person sets up a new second factor at the next sign-in and receives an e-mail. A reason is required; it goes into the audit log and the e-mail. |
| **Deactivate account** | As described above. |
| **Reactivate** | For deactivated accounts. The account can sign in again and gets back its memberships and roles. |

These actions ask you to confirm your identity first and are recorded in the audit log.

## Placeholders

A placeholder stands for a person who has no account yet, for example the author of imported content. It cannot sign in. Imports create placeholders as well, see [Imports](imports.md).

To create one:

1. Open **Settings › Instance › People and sign-in › Accounts**.
2. Select **Add a person without an account**.
3. Enter the name and the e-mail address, then select **Create placeholder**.

When the person signs in through an identity provider for the first time with that address, and the provider verifies the address, the placeholder becomes their account under the same rules as an account created at sign-in. It keeps its memberships, groups and roles. An address that is not verified never takes over a placeholder.

When the person signed in with another address, merge the placeholder into their account:

1. Open the placeholder's account page.
2. Under **Merge into an account**, search the account by name or e-mail address.
3. Select **Merge** and confirm your identity.

The placeholder's memberships, group memberships and organization roles move to the account, and so do the content, comments and tasks attributed to it. The merged placeholder loses its name and address and points to the account; its audit entries belong to the account from then on. Nobody can merge a placeholder into their own account.

## Anonymizing an account

Anonymization removes a person's personal data for good, for example after an erasure request. It cannot be undone.

1. Open the account page and select **Anonymize account…** in the danger zone.
2. Enter a reason of up to 500 characters. It is kept in the audit log; do not name the person, for example "erasure request of 1 October 2026".
3. Type the name of the account to confirm.
4. Confirm your identity when Lunedo asks for it.

What happens:

- Name, e-mail address, sign-in names and profile are removed. The account shows as a former user with the first characters of its ID.
- Linked sign-ins, sessions, API tokens, passkeys, second factors, recovery codes, notifications and personal settings are deleted.
- All memberships, roles and group memberships end.
- Pages, comments and history stay and show the former user.
- The audit log keeps the events with the account ID only; the account's personal data there becomes unreadable, including the data of placeholders merged into it and of invitations to its addresses. Copies of the audit log that were exported or streamed to other systems are outside Lunedo; remove the data there if needed.

The instance owner, service and portal accounts and the own account cannot be anonymized. Accounts that hold an instance role can be anonymized only by the instance owner.

## Reminders and inactivity

Lunedo reminds the people responsible before access ends, and tells them when guests stay inactive. The periods are organization settings under **Settings › Organization › People and access › Domains and guests**:

| Setting | Default | Range |
|---|---|---|
| Guest expiry reminder | 7 days | 1 to 90 days |
| Inactive guests | 30 days | 1 to 365 days |
| Access expiry reminder | 7 days | 1 to 90 days |

API token reminders are instance settings under **Settings › Instance › People and sign-in › Policies**, section **API tokens**, see [Service accounts](service-accounts.md#tokens-and-reminders).
