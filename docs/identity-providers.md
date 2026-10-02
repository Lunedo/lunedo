# Identity providers

People can sign in through OpenID Connect providers such as Microsoft Entra ID, Google Workspace, Keycloak or Authentik, in addition to passwords and passkeys. SAML and LDAP follow on the same framework.

## Levels

- **Instance providers** are set up by holders of the instance area "sign-in and security". The instance offers them to chosen organizations, and each organization turns them on or off for itself (`PUT /api/v1/organizations/{id}/sign-in-providers/{providerId}`).
- **Organization providers** are set up by holders of the organization area "sign-in and security". They belong to that organization only and sign in only accounts whose home organization it is. They never create accounts of other organizations and never grant instance roles.

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

The owners of the level (the instance owner, or the owners of the organization) get the notification `identityProvider.credentialExpiring` 30 and 7 days before the last valid credential expires, and the provider list shows a warning.

## OpenID Connect

Pagehall uses [openid-client](https://github.com/panva/openid-client): discovery from the issuer URL, the authorization code flow with PKCE (S256), `state` and `nonce`. State, nonce and code verifier are stored in the database, are valid for 10 minutes and are used once. The state is also bound to the browser through the cookie `__Host-pagehall-provider`, so a sign-in started in one browser cannot be completed in another. ID tokens are checked for issuer, audience, expiry, nonce and the configured signature algorithm; unsigned tokens and tokens signed with another algorithm are refused.

The redirect URI is `{instance URL}/api/v1/auth/providers/{providerId}/callback`, one per provider, and is shown in the setup.

Presets:

| Preset | Issuer | Identifier | Notes |
|---|---|---|---|
| Microsoft Entra ID | `https://login.microsoftonline.com/{tenant ID}/v2.0` | tenant ID and object ID (`tid:oid`) | Only one tenant, never the multi-tenant endpoints. The e-mail address comes from the `email` claim, the user principal name, or the `mail` attribute read through Microsoft Graph with the provider's own credential. |
| Google Workspace | `https://accounts.google.com` | `sub` | The `hd` claim must be one of the configured domains. |
| Other providers | configured | `sub` | Claim names for e-mail address, sign-in name, display name and groups are configurable. |

Providers must be reached through HTTPS. `PAGEHALL_INSECURE_IDENTITY_PROVIDERS=true` allows HTTP and other issuers for the presets, for development and tests only.

## Identities

An account can have several linked identities. An identity is unique per provider and identifier. E-mail address, sign-in name and display name are updated at every sign-in. Pagehall never recognizes an account by e-mail address alone: an address counts as verified only when its domain is one of the provider's configured domains.

## First sign-in

When nobody is linked to the identity yet:

1. If the verified e-mail address belongs to an existing account, the person links the identity by confirming with that account's password and, if it has one, its second factor (`/sign-in/link`). Pagehall never links automatically. "This is not my account" ends the sign-in with a reference. Accounts without a password are linked by an administrator.
2. Otherwise, when the provider allows accounts at first sign-in and the address lies in a configured domain, Pagehall creates a standard account without a password. Optionally, the token must carry one of a list of groups. The home organization is the provider's organization for organization providers; for instance providers it is the organization that owns the e-mail domain, or the organization whose sign-in page started the sign-in, if the provider is turned on there.
3. Otherwise the sign-in is refused.

Every refusal gets a reference such as `7KQ2-M9XA`. The refusal page shows it, and administrators look it up at `GET /api/v1/instance/sign-in-refusals/{reference}` or `GET /api/v1/organizations/{id}/sign-in-refusals/{reference}`. Refusals are kept for 90 days.

Reasons: `accountCreationDisabled`, `domainNotAllowed`, `emailNotVerified`, `groupRequired`, `otherOrganization`, `accountInactive`, `providerNotEnabled`, `linkDeclined`, `linkUnavailable`, `invalidResponse`.

## Sessions and sign-out

Sessions created through a provider remember the identity and the provider's session ID (`sid`). Provider sign-ins satisfy the second-factor requirement; the provider is responsible for multi-factor authentication. The back-channel logout endpoint `POST /api/v1/auth/providers/{providerId}/backchannel-logout` accepts a signed logout token, refuses replayed tokens and tokens with a nonce, and ends the sessions from that provider sign-in.

Accounts without a password confirm sensitive actions through the provider (`POST /api/v1/auth/reauthenticate/provider`). Pagehall asks for a fresh sign-in (`prompt=login`, `max_age=0`) and checks `auth_time`.

Administrators link and unlink identities in the account panel. Unlinking ends the sessions from that identity; removing the last way to sign in is refused.

## Password sign-in and emergency sign-in

`auth.passwordSignIn` (instance and organization, lockable, may only be turned off at lower levels) decides whether members sign in with a password. When it is off, they sign in through a provider or a passkey.

The instance owner can always sign in with password and second factor. When password sign-in is off for the owner, this counts as emergency sign-in: it is audited as `auth.emergencySignIn` and all instance administrators get the notification `auth.emergencySignIn` at once.

## Audit events

`identityProvider.created`, `.updated`, `.removed`, `.availabilityChanged`, `.enabledChanged`, `.credentialAdded`, `.credentialRemoved`, `.logoChanged`; `auth.signedIn` with `providerId`, `auth.signInRefused` with reason and reference, `auth.providerSignedOut`, `auth.emergencySignIn`; `identity.linked`, `identity.unlinked`; `account.createdAtSignIn`.
