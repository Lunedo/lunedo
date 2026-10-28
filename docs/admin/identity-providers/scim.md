# SCIM

Checked against Microsoft Entra documentation, October 2026.

With SCIM 2.0, an identity provider sends changes of people and groups to Lunedo itself, instead of waiting for the next sign-in or synchronization. How soon depends on the provider; Microsoft Entra ID sends changes in provisioning cycles about every 40 minutes. Accounts are created before the first sign-in and deactivated, never deleted. Every provider in Lunedo can receive SCIM requests, whatever its sign-in method.

For the steps in Microsoft Entra ID, see [Microsoft Entra ID](entra-id.md#scim).

## Turning SCIM on

1. Open the provider in **Settings › Instance › People and sign-in › Sign-in methods** and choose the tab **SCIM**.
2. Choose **Create token**. Copy the token now; Lunedo shows it only once and stores only a hash of it.
3. At the provider, enter the **Tenant URL** shown in the tab, for example `https://wiki.example.com/scim/v2/{provider ID}`, and the token as bearer token.
4. Configure the provider so that `externalId` carries the identifier the provider uses at sign-in.
5. Test the connection at the provider.

SCIM is on while the provider has a token. A token works only for its own provider.

The tab shows the status (Off, Waiting for requests, Receiving, Refused requests) and the last request from the provider, with the number of accepted changes and refused requests in the last 24 hours.

## Renewing and removing tokens

- **Renew** creates a new token. The previous token keeps working for seven days, so the new one can be entered at the provider without an interruption.
- Removing a token stops it at once. Without a token, SCIM is off and the background synchronization returns to its interval.

Creating, renewing and removing tokens is recorded in the [audit log](../audit-log.md). Tokens never appear in the audit log or the sync log.

## Users

- Users are the identities of the provider. Lunedo identifies them by `externalId`, or by `userName` when no `externalId` is sent. For Microsoft Entra ID, `externalId` must be the object ID of the user.
- A new user becomes a standard account that has not signed in yet, with the identity already linked, so the first sign-in through the provider signs it in. The account is [managed](../identity-providers.md#managed-accounts) by the provider from the start. Everyone assigned to the application at the provider gets an account, even when **Create accounts at first sign-in** is off for the provider. No e-mail is sent.
- The e-mail address of a user must lie in one of the provider's domains. A user without an e-mail address is refused.
- When a placeholder account has the address, it becomes the account. An existing account with the address is never linked by SCIM; it is linked when the person signs in (see [First sign-in](../identity-providers.md#first-sign-in)).
- The home organization comes from the e-mail domain or, once the user is in groups, from the mapping rules, as at sign-in.
- `active: false` and `DELETE` deactivate the account; they never delete it, and it stays managed by the provider. `active: true` reactivates it only if this provider deactivated it.
- Attributes Lunedo does not use, such as roles or the enterprise extension, are ignored. SCIM never grants a role by itself; roles come from [mapping rules](identity-provider-groups.md#mapping-rules).

## Groups

- Groups are the groups Lunedo knows from the provider; mapping rules refer to them by `externalId`.
- Member changes, also in batches, apply the mapping rules at once.
- Deleting a group removes what its rules granted and marks its rules as pointing to a missing group.

## Requests

- Users are found by `userName`, `externalId`, `id` and `emails.value`, with filters of the form `attribute eq "value"`. A page holds up to 200 resources.
- `PATCH` accepts the formats Microsoft Entra ID sends, including capitalized operations, `"True"` and `"False"` as text, and paths such as `emails[type eq "work"].value`.
- Bulk requests, sorting and ETags are not supported.
- Requests are limited to 1200 per minute and provider. Requests with a wrong token are limited per client address.
- A deactivated provider refuses SCIM requests.

Every request that changed something or failed appears in the sync log of the provider with the trigger "SCIM", with its changes and errors. Open pages such as the account list show the changes without a reload. Changes of users and groups are recorded in the audit log.

## SCIM and synchronization

While SCIM is on, SCIM leads: the background synchronization of the provider runs once a day as a reconciliation, shown with the trigger "Reconciliation" in the sync log, instead of at its configured interval. For providers without a directory, SCIM is the only way to learn about changes before the next sign-in. See [Synchronization](identity-provider-groups.md#synchronization).
