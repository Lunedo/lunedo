# Identity providers

People can sign in through OpenID Connect providers such as Microsoft Entra ID, Google Workspace, Keycloak or Authentik, in addition to passwords and passkeys, through SAML 2.0 providers such as Entra ID and ADFS, and through LDAP directories such as Active Directory and OpenLDAP.

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

## SAML

Pagehall is the service provider. Its entity ID and metadata are at `{instance URL}/api/v1/auth/providers/{providerId}/saml/metadata`, and responses arrive at `…/saml/acs`. The assertion must always be signed; a signature over the whole response is required only when the provider setting `requireSignedResponse` is on. Each assertion is accepted once. Sign-in started at the identity provider is off by default (`idpInitiated`).

Presets:

- Microsoft Entra ID: the person is identified by tenant ID and object ID. Groups come as object IDs. Assertions carry at most 150 groups; for people in more groups, Entra ID sends a link instead, and Pagehall reads the groups through Microsoft Graph. This needs the client ID of an app registration (`graphClientId`) and its client secret or certificate, which the setup assistant asks for as a step of its own. Without them, the provider shows the warning `noGraphCredential`: accounts with many groups lose their groups and what the rules give them.
- ADFS: the person is identified by `objectGUID`. Groups come as SIDs by default: add the claim rule "Token-Groups as SIDs" (claim type `http://schemas.microsoft.com/ws/2008/06/identity/claims/groupsid`). Group names ("Token-Groups – Unqualified Names") remain possible with `groupValues: "names"`.
- Other providers: identifier, e-mail address, sign-in name, display name and groups come from configurable attributes; `groupValues` says whether the groups attribute carries identifiers or names.

When the group values are names, the provider reports `capabilities.groupsByName`, and the rule list and the rule dialog warn that renaming a group in the provider breaks its rules.

## LDAP

Directories are reached through LDAPS or StartTLS with a service account. People sign in with their directory password on the Pagehall sign-in page. Active Directory identifies people and groups by `objectGUID`; other directories by `entryUUID`.

## Testing a provider

The setup assistant and the provider page test a provider with a real sign-in (OpenID Connect and SAML) or a directory lookup (LDAP). Nothing is saved and no account is created. The result shows the identifier, the profile, the groups, and the claims or attributes as received. Tokens, assertions in raw form, hashes, nonces and secrets are never shown.

## Identities

An account can have several linked identities. An identity is unique per provider and identifier. E-mail address, sign-in name and display name are updated at every sign-in. Pagehall never recognizes an account by e-mail address alone: an address counts as verified only when its domain is one of the provider's configured domains.

## First sign-in

When nobody is linked to the identity yet:

1. If the verified e-mail address belongs to an existing account, the person links the identity by confirming with that account's password and, if it has one, its second factor (`/sign-in/link`). Pagehall never links automatically. "This is not my account" ends the sign-in with a reference. Accounts without a password are linked by an administrator.
2. Otherwise, when the provider allows accounts at first sign-in and the address lies in a configured domain, Pagehall creates a standard account without a password. Optionally, the person must be in one of a list of groups. The home organization comes from the first mapping rule, in rule order, that names one for a group of the person; otherwise it is the organization that owns the e-mail domain, if one does. When neither gives one, the first organization a rule makes the person a member of becomes the home organization. When the account ends up in no organization at all, after sign-in the person sees that no organization is assigned yet and that the administrators were told, and instance administrators get the notification `account.withoutOrganization`. The account list of the instance shows every account's organizations, the home organization marked with a house, and has the filter "Without organization" for accounts without any membership (`GET /api/v1/instance/accounts?withoutOrganization=true`), and people who manage accounts assign one (`POST /api/v1/instance/accounts/{accountId}/organization`, audited as `account.organizationAssigned`).
3. Otherwise the sign-in is refused.

Every refusal gets a reference such as `7KQ2-M9XA`. The refusal page shows it, and administrators look it up at `GET /api/v1/instance/sign-in-refusals/{reference}`. Refusals are kept for 90 days.

Reasons: `accountCreationDisabled`, `domainNotAllowed`, `emailNotVerified`, `groupRequired`, `accountInactive`, `linkDeclined`, `linkUnavailable`, `invalidResponse`.

## Groups

Groups are identified by their stable ID at the provider, never by their name. Pagehall stores the names it sees and updates them when the provider renames a group; rules keep working.

- Generic OpenID Connect providers send groups in a claim set in the provider (`claims.groups`, for example `groups`). An optional second claim (`claims.groupNames`) carries the names in the same order; Keycloak and Authentik can send both.
- Microsoft Entra ID sends group IDs in the token. When a person is in too many groups, the token carries an overage reference instead, and Pagehall reads the groups through Microsoft Graph with the provider's own credential (client credentials, application permissions `GroupMember.Read.All` and `User.Read.All`), never with the person's token. Nested groups count.
- Google Workspace does not put groups into the token. Group synchronization is optional: without it, Google Workspace is used for sign-in only and mapping rules see no groups. With it, Pagehall reads groups through the Directory API with a service account, in one of two ways:
  - Administrator role (recommended): create a service account in Google Cloud and a JSON key for it. In the Google Admin console, under Account > Admin roles, assign the prebuilt role Groups Reader to the service account. Pagehall requests only the read-only scope `admin.directory.group.readonly` and acts as the service account itself, so the Google audit log shows the service account. To detect suspended or deleted accounts during synchronization, assign a role that can also read users (for example a custom role with Users > Read) and turn on "Detect suspended accounts"; Pagehall then also requests `admin.directory.user.readonly`. Without it, Pagehall does not see suspensions; a suspended person can no longer sign in through Google, but sessions already open run until they expire.
  - Domain-wide delegation: authorize the service account for the scopes `admin.directory.group.readonly` and `admin.directory.user.readonly` under Security > API controls > Domain-wide delegation, and enter the address of an administrator the service account acts for. Delegation lets the service account use these scopes for the whole domain as that administrator; use it only when the administrator role is not possible.

  In both cases, upload the JSON key in the provider settings. The key is stored encrypted and never shown again.

When groups cannot be read at sign-in, for example because Graph is not reachable, the person is signed in with the groups Pagehall knew before.

## Synchronization

Providers with a directory (Entra ID, and Google Workspace with group synchronization and a service account key) are synchronized in the background, every 60 minutes by default (`config.sync.intervalMinutes`, 15 to 1440), and on "Sync now". A run updates profiles and groups of linked accounts, applies the mapping rules, follows renamed groups and marks deleted ones. Runs are background jobs in their own queue, so they never hold up other jobs. Only one run per provider happens at a time, on any number of nodes. Every request to the provider has a timeout of ten seconds. A run sends a heartbeat before each account; a run without a heartbeat for five minutes counts as aborted, and the next run can start. A running sync can be cancelled from the sync log: it stops before the next account, keeps the changes made so far and is recorded as cancelled (`identityProvider.syncCancelled`). Generic providers have no directory: their accounts update at every sign-in.

An account that the provider disabled or deleted is deactivated: its sessions and personal API tokens end. Pagehall never deletes accounts. When the provider enables the account again, Pagehall reactivates it, but only if this provider deactivated it.

Every run is kept in the sync log with trigger, result, duration, changes and warnings, for `identityProviders.syncLogRetentionDays` days (instance, default 90).

## Mapping rules

A rule maps a group of a provider to:

- membership in an organization, optionally with a role, optionally adding the members to a synchronized Pagehall group, and optionally making the organization the home organization; or
- an instance role. Groups of organizations in Pagehall never receive instance roles; only rules of providers do.

Creating, changing, reordering and removing a rule is a grant: the authorization service checks that the person may manage members of the organization and may grant the role themselves. Rules apply at every sign-in and synchronization. Several rules add up. When someone leaves a group, Pagehall removes exactly what the rules granted; access granted by hand stays, and a membership stays while the person holds other access in the organization. When the membership that ends was the home organization, the home organization moves to the next remaining standard membership or to none (see [organizations.md](organizations.md)). The option "Make this organization the home organization" is only needed when rules lead into several organizations; otherwise the first organization an account joins becomes its home organization. When several rules name a home organization, the first in rule order decides. A rule whose group no longer exists at the provider grants nothing, is marked in the list and produces a warning in the sync log.

Synchronized Pagehall groups are read-only: their members, managers, name and description come from the provider, and the group shows which provider manages it. When the provider renames a group, the synchronized group follows at the next sign-in or synchronization; if the name is taken in the organization, the provider name is added in parentheses, for example "engineering (Keycloak)". Renames appear in the sync log with the old and the new name. Their permissions in Pagehall can still be changed.

When the groups of a person cannot be read at sign-in or during a synchronization, memberships stay as last known. If the last successful read is older than twice the provider's sync interval, instance roles and the organization roles owner and administrator that come from mapping rules are paused: the authorization service does not count them. The person sees which roles are paused and why (`GET /api/v1/account/withheld-roles`), instance administrators get the notification `account.rolesWithheld` once, and the roles return at the next successful read.

The rule dialog searches the provider's groups (the directory, or the groups seen at sign-in for generic providers) and shows beforehand who gains access.

## Deactivating and removing a provider

Deactivate a provider to stop it without losing anything: nobody can sign in through it, the sign-in page no longer offers it, a running synchronization stops and no new one starts, and the sessions that came from it end. Settings, credentials, identities, rules, groups and access stay, and everything works again once the provider is activated (`identityProvider.deactivated`, `identityProvider.activated`).

Removing a provider cannot be undone. Before the removal, Pagehall shows how many accounts lose their identity and how many of them have no other working way to sign in (another active provider, a passkey, or a password while password sign-in is on or for the instance owner), and how many groups, rules and granted memberships and roles are affected. The removal ends the sessions from the provider, deletes its identities and rules, and withdraws the memberships and roles its rules granted. Its synchronized groups become ordinary groups with their members and permissions and show "formerly synchronized from" the provider. The removal is audited as `identityProvider.removed` with the number of ended sessions and released groups.

## Sessions and sign-out

Sessions created through a provider remember the identity and the provider's session ID (`sid`). Each provider has a second-factor setting (`config.secondFactor.mode`). "Handled by the provider" (`provider`, the default) makes a provider sign-in complete. "Require proof from the provider" (`providerProof`) accepts the sign-in only when the `amr` claim of the ID token contains one of `config.secondFactor.proofValues` (default `mfa`). "Always ask for a Pagehall second factor" (`pagehall`) asks every time. When Pagehall asks, the person confirms with their TOTP code, passkey or recovery code; a person without a second factor gets a session that only allows setting one up. The back-channel logout endpoint `POST /api/v1/auth/providers/{providerId}/backchannel-logout` accepts a signed logout token, refuses replayed tokens and tokens with a nonce, and ends the sessions from that provider sign-in.

Accounts without a password confirm sensitive actions through the provider (`POST /api/v1/auth/reauthenticate/provider`). Pagehall asks for a fresh sign-in (`prompt=login`, `max_age=0`) and checks `auth_time`.

Administrators link and unlink identities in the account panel. Unlinking ends the sessions from that identity; removing the last way to sign in is refused.

## Password sign-in and emergency sign-in

`auth.passwordSignIn` is an instance setting and decides whether people sign in with a password. When it is off, they sign in through a provider or a passkey. Requiring a second factor stays a setting that organizations can make stricter for their members.

The instance owner can always sign in with password and second factor. When password sign-in is off for the owner, this counts as emergency sign-in: it is audited as `auth.emergencySignIn`, and the recipients get the notification `auth.emergencySignIn` at once. The instance owner is always told. By default, all instance owners and administrators are told as well; the instance owner can turn that off, add further people and add e-mail addresses outside Pagehall (`PUT /api/v1/instance/emergency-sign-in-recipients`). Only the instance owner can change the recipients, and every change is audited as `settings.changed`.

## Audit events

`identityProvider.created`, `.updated`, `.deactivated`, `.activated`, `.removed`, `.credentialAdded`, `.credentialRemoved`, `.logoChanged`, `.directoryKeyChanged`, `.synchronized` with the result of the run; `mappingRule.created`, `.updated`, `.removed`; `account.deactivatedByProvider`, `account.reactivatedByProvider`; memberships, roles and group members changed by rules, with the reason `providerRule`; `auth.signedIn` with `providerId`, `auth.signInRefused` with reason and reference, `auth.providerSignedOut`, `auth.emergencySignIn`; `identity.linked`, `identity.unlinked`; `account.createdAtSignIn`.
