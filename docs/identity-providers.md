# Identity providers

People can sign in through OpenID Connect providers such as Microsoft Entra ID, Google Workspace, Keycloak or Authentik, in addition to passwords and passkeys. SAML and LDAP follow on the same framework.

## Configured for the whole instance

Providers are set up for the instance by holders of the instance area "sign-in and security". Organizations do not choose or configure sign-in methods; which organizations a person belongs to follows from group mapping after sign-in.

Each provider has a list of e-mail domains. A domain belongs to at most one provider; assigning a domain another provider already has is refused with `domainInUse`. The domains choose the provider on the sign-in page, decide which addresses count as verified, and limit accounts at first sign-in.

## Sign-in page

The page asks for the e-mail address first (`POST /api/v1/auth/sign-in/discover`). The domain chooses the next step:

- `provider`: the domain belongs to a provider, and the person continues there.
- `password`: password sign-in is allowed, and the person enters a password. The form then answers like any password sign-in.
- `none`: no sign-in method is set up for this address.

The answer depends only on the domain and the settings, never on whether an account with the address exists, so the page cannot be used to find out who has an account. The questions are limited per client; too many answer `429` with `rateLimited`.

`GET /api/v1/auth/sign-in-options` tells the page what to show:

- With exactly one provider and password sign-in off, the page shows that provider's button directly, without the e-mail step (`directProvider`).
- Passkeys are always offered and work without an address.
- After a sign-in through a provider, the browser keeps the provider in the cookie `__Host-pagehall-last-provider`, which holds only the provider's ID. The options name it as `lastProvider`, offered as a shortcut, as long as the provider exists.

## Framework

Every provider type implements one adapter interface in `packages/server/src/identity/adapter.ts`:

- `authorizationUrl` and `completeSignIn` for redirect-based sign-in,
- `verifyLogout` for back-channel logout,
- `readProfile`, `readGroups` and `synchronizeAccounts` for background synchronization.

The sign-in flow, linking, accounts at first sign-in and the refusal page do not depend on the protocol, so new protocols only add an adapter.

## Credentials

A provider has one or more credentials:

- a client secret with its expiry date, entered from the provider's console, or
- a certificate whose RSA key pair Pagehall generates. The private key never leaves Pagehall; the public certificate is downloaded (`GET …/credentials/{id}/certificate`) and registered with the provider. Pagehall authenticates with `private_key_jwt`.

Secrets and private keys are stored with envelope encryption (see [encryption.md](encryption.md)) and are never returned by the API. During a renewal, add the new credential first: Pagehall uses the newest one and falls back to older ones when the provider rejects it, until the old one is removed. The last credential cannot be removed.

The instance owner and the holders of the instance area "sign-in and security" get the notification `identityProvider.credentialExpiring` 30 and 7 days before the last valid credential expires, and the provider list shows a warning.

## OpenID Connect

Pagehall uses [openid-client](https://github.com/panva/openid-client): discovery from the issuer URL, the authorization code flow with PKCE (S256), `state` and `nonce`. State, nonce and code verifier are stored in the database, are valid for 10 minutes and are used once. The state is also bound to the browser through the cookie `__Host-pagehall-provider`, so a sign-in started in one browser cannot be completed in another. ID tokens are checked for issuer, audience, expiry, nonce and the configured signature algorithm; unsigned tokens and tokens signed with another algorithm are refused.

The redirect URI is `{instance URL}/api/v1/auth/providers/{providerId}/callback`, one per provider, and is shown in the setup.

Presets:

| Preset | Issuer | Identifier | Notes |
|---|---|---|---|
| Microsoft Entra ID | `https://login.microsoftonline.com/{tenant ID}/v2.0` | tenant ID and object ID (`tid:oid`) | Only one tenant, never the multi-tenant endpoints. The e-mail address comes from the `email` claim, the user principal name, or the `mail` attribute read through Microsoft Graph with the provider's own credential. |
| Google Workspace | `https://accounts.google.com` | `sub` | The `hd` claim must be one of the configured domains. |
| Other providers | configured | `sub` | Claim names for e-mail address, sign-in name, display name and groups are configurable. |

Providers must be reached through HTTPS. Microsoft Graph and the Google Directory API are only called on their own hosts: the Graph endpoint of the Microsoft cloud of the provider's authority, `admin.googleapis.com` and `oauth2.googleapis.com`. `PAGEHALL_INSECURE_IDENTITY_PROVIDERS=true` allows HTTP, other issuers for the presets and other directory hosts, for development and tests only.

## Identities

An account can have several linked identities. An identity is unique per provider and identifier. E-mail address, sign-in name and display name are updated at every sign-in. Pagehall never recognizes an account by e-mail address alone: an address counts as verified only when its domain is one of the provider's configured domains.

## First sign-in

When nobody is linked to the identity yet:

1. If the verified e-mail address belongs to an existing account, the person links the identity by confirming with that account's password and, if it has one, its second factor (`/sign-in/link`). Pagehall never links automatically. "This is not my account" ends the sign-in with a reference. Accounts without a password are linked by an administrator.
2. Otherwise, when the provider allows accounts at first sign-in and the address lies in a configured domain, Pagehall creates a standard account without a password. Optionally, the person must be in one of a list of groups. The home organization comes from the first mapping rule, in rule order, that names one for a group of the person; otherwise it is the organization that owns the e-mail domain, if one does.
3. Otherwise the sign-in is refused.

Every refusal gets a reference such as `7KQ2-M9XA`. The refusal page shows it, and administrators look it up at `GET /api/v1/instance/sign-in-refusals/{reference}`. Refusals are kept for 90 days.

Reasons: `accountCreationDisabled`, `domainNotAllowed`, `emailNotVerified`, `groupRequired`, `accountInactive`, `linkDeclined`, `linkUnavailable`, `invalidResponse`.

## Groups

Groups are identified by their stable ID at the provider, never by their name. Pagehall stores the names it sees and updates them when the provider renames a group; rules keep working.

- Generic OpenID Connect providers send groups in a claim set in the provider (`claims.groups`, for example `groups`). An optional second claim (`claims.groupNames`) carries the names in the same order; Keycloak and Authentik can send both.
- Microsoft Entra ID sends group IDs in the token. When a person is in too many groups, the token carries an overage reference instead, and Pagehall reads the groups through Microsoft Graph with the provider's own credential (client credentials, application permissions `GroupMember.Read.All` and `User.Read.All`), never with the person's token. Nested groups count.
- Google Workspace does not put groups into the token. Pagehall reads them through the Directory API with a service account: create a service account with domain-wide delegation for the read-only scopes `admin.directory.group.readonly` and `admin.directory.user.readonly`, set the e-mail address of an administrator to act for in the provider's directory settings, and upload the JSON key. The key is stored encrypted and never shown again.

When groups cannot be read at sign-in, for example because Graph is not reachable, the person is signed in with the groups Pagehall knew before.

## Synchronization

Providers with a directory (Entra ID, and Google Workspace with a service account key) are synchronized in the background, every 60 minutes by default (`config.sync.intervalMinutes`, 15 to 1440), and on "Sync now". A run updates profiles and groups of linked accounts, applies the mapping rules, follows renamed groups and marks deleted ones. Only one run per provider happens at a time, on any number of nodes; a run that is still marked as running after two hours counts as interrupted. Generic providers have no directory: their accounts update at every sign-in.

An account that the provider disabled or deleted is deactivated: its sessions and personal API tokens end. Pagehall never deletes accounts. When the provider enables the account again, Pagehall reactivates it, but only if this provider deactivated it.

Every run is kept in the sync log with trigger, result, duration, changes and warnings, for `identityProviders.syncLogRetentionDays` days (instance, default 90).

## Mapping rules

A rule maps a group of a provider to:

- membership in an organization, optionally with a role, optionally adding the members to a synchronized Pagehall group, and optionally making the organization the home organization of new accounts; or
- an instance role. Groups of organizations in Pagehall never receive instance roles; only rules of providers do.

Creating, changing, reordering and removing a rule is a grant: the authorization service checks that the person may manage members of the organization and may grant the role themselves. Rules apply at every sign-in and synchronization. Several rules add up. When someone leaves a group, Pagehall removes exactly what the rules granted; access granted by hand stays, and a membership stays while the person holds other access in the organization or it is their home organization. When several rules name a home organization, the first in rule order decides. A rule whose group no longer exists at the provider grants nothing, is marked in the list and produces a warning in the sync log.

Synchronized Pagehall groups are read-only: their members, managers, name and description come from the provider, and the group shows which provider manages it. Their permissions in Pagehall can still be changed.

The rule dialog searches the provider's groups (the directory, or the groups seen at sign-in for generic providers) and shows beforehand who gains access.

## Sessions and sign-out

Sessions created through a provider remember the identity and the provider's session ID (`sid`). Provider sign-ins satisfy the second-factor requirement; the provider is responsible for multi-factor authentication. The back-channel logout endpoint `POST /api/v1/auth/providers/{providerId}/backchannel-logout` accepts a signed logout token, refuses replayed tokens and tokens with a nonce, and ends the sessions from that provider sign-in.

Accounts without a password confirm sensitive actions through the provider (`POST /api/v1/auth/reauthenticate/provider`). Pagehall asks for a fresh sign-in (`prompt=login`, `max_age=0`) and checks `auth_time`.

Administrators link and unlink identities in the account panel. Unlinking ends the sessions from that identity; removing the last way to sign in is refused.

## Password sign-in and emergency sign-in

`auth.passwordSignIn` is an instance setting and decides whether people sign in with a password. When it is off, they sign in through a provider or a passkey. Requiring a second factor stays a setting that organizations can make stricter for their members.

The instance owner can always sign in with password and second factor. When password sign-in is off for the owner, this counts as emergency sign-in: it is audited as `auth.emergencySignIn` and all instance administrators get the notification `auth.emergencySignIn` at once.

## Audit events

`identityProvider.created`, `.updated`, `.removed`, `.credentialAdded`, `.credentialRemoved`, `.logoChanged`, `.directoryKeyChanged`, `.synchronized` with the result of the run; `mappingRule.created`, `.updated`, `.removed`; `account.deactivatedByProvider`, `account.reactivatedByProvider`; memberships, roles and group members changed by rules, with the reason `providerRule`; `auth.signedIn` with `providerId`, `auth.signInRefused` with reason and reference, `auth.providerSignedOut`, `auth.emergencySignIn`; `identity.linked`, `identity.unlinked`; `account.createdAtSignIn`.
