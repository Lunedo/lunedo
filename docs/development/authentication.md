# Authentication

This page describes how the web client and the API sign people in, confirm their identity and protect state-changing requests. The rules and settings for administrators are in [docs/admin/authentication.md](../admin/authentication.md); identity providers are described in [Identity providers](identity-providers.md).

The services live in `packages/server/src/auth/` (passwords, second factors, sessions, throttling) and `packages/server/src/identity/` (providers). The routes are in `apps/api/src/auth/` and `apps/api/src/identity/provider-auth.controller.ts`.

## Cookies

| Cookie | Lifetime | Holds |
|---|---|---|
| `__Host-lunedo-session` | until the session ends | Random 256-bit session ID; the database stores its SHA-256 hash |
| `__Host-lunedo-pending` | 5 minutes | Token of a pending sign-in waiting for its second step |
| `__Host-lunedo-device` | 400 days | Random ID of the browser; a new sign-in from the same browser replaces its previous session |
| `__Host-lunedo-provider` | 10 minutes | Browser token of a provider flow (see [Identity providers](identity-providers.md#state-nonce-and-verifier)) |
| `__Host-lunedo-link` | 15 minutes | Token of an identity waiting to be linked to an existing account |
| `__Host-lunedo-last-provider` | 180 days | ID of the provider used last, offered as a shortcut |

All are `HttpOnly`, `Secure`, `SameSite=Lax` and `Path=/` (`apps/api/src/http/cookies.ts`).

## Sign-in flow

1. The sign-in page loads `GET /api/v1/auth/sign-in-options`: the active providers and the provider used last. The page always shows the provider buttons and the e-mail field; passkeys are always offered.
2. The page sends the address to `POST /api/v1/auth/sign-in/discover`. The answer is one of `provider`, `directory` or `password` and depends only on the domain and the active providers. 30 requests per client and minute.
3. Then, by method:
   - **Password**: `POST /api/v1/auth/sign-in`. A managed account is refused with `managedAccount` after a correct password (see [Managed accounts](#managed-accounts)). Without a second factor, the answer sets the session cookie. Otherwise it sets the pending cookie and names the factors; the client completes with `POST /api/v1/auth/sign-in/second-factor` and a TOTP code, a recovery code or a passkey assertion (options from `POST /api/v1/auth/sign-in/second-factor/passkey-options`). The pending sign-in ends after five wrong attempts.
   - **Passkey without password**: `POST /api/v1/auth/sign-in/passkey-options`, then `POST /api/v1/auth/sign-in/passkey`. Managed accounts are refused with `managedAccount`.
   - **OIDC or SAML provider**: `POST /api/v1/auth/providers/{providerId}/start` returns the provider address and sets the provider cookie. The provider sends the browser back to `GET /api/v1/auth/providers/{providerId}/callback`; a SAML response arrives first at `POST …/saml/acs`, which keeps it with the flow and redirects to the callback. The callback answers `303` to the next page: the requested page, `/sign-in/verify` for the instance owner's second factor, `/sign-in/link` when the instance owner or an administrator confirms a link, `/sign-in/refused` with reference and reason, or `/sign-in?error={code}`.
   - **Directory**: `POST /api/v1/auth/providers/{providerId}/password` with sign-in name and password. Lunedo's attempt limits and lockouts apply before the directory is asked.
4. A session that still needs a second factor because the instance, an organization or a reset requires one is a setup session: only routes marked `secondFactorSetup` accept it, others answer `403` with `secondFactorSetupRequired`.

Linking an identity to an existing account (see [First sign-in](../admin/identity-providers.md#first-sign-in)). Accounts with only member roles are linked and taken over at once; the instance owner and accounts with a role above member (`confirmsLinks` in `identity/managed.ts`) confirm:

- `GET /api/v1/auth/link` describes the waiting identity and the ways to confirm.
- `POST /api/v1/auth/link` confirms with the Lunedo password and second factor.
- `POST /api/v1/auth/link/passkey-options`, then `POST /api/v1/auth/link` with the passkey assertion.
- `POST /api/v1/auth/link/provider` starts a fresh sign-in at a provider already linked to the account; `POST /api/v1/auth/link/directory` confirms with a linked directory's password.
- `POST /api/v1/auth/link/decline` ends the sign-in with a refusal reference.

A local sign-in of the instance owner, with password or passkey, while at least one provider is active and set up, is an emergency sign-in: `SignInService` records `auth.emergencySignIn` and notifies the recipients from `emergencyRecipientsOf` (`packages/server/src/auth/emergency-recipients.ts`) when it creates the session.

Sign-in is refused with `setupIncomplete` before the setup is complete. During maintenance, every route that creates a session answers `503` with `signInPaused`, except for instance administrators; the provider callback redirects to `/sign-in?error=signInPaused`.

## Managed accounts

`packages/server/src/identity/managed.ts` keeps the managed state in the table `managed_accounts`: one row per managed account with the provider, the source (`identity` or `domain`) and since when. The rules are in [Managed accounts](../admin/identity-providers.md#managed-accounts).

- `refreshManagedAccounts(tx, audit, target, actor)` recomputes the state for a list of accounts or for every account a provider touches through a row, an identity or a domain. It locks the accounts in ID order with `FOR UPDATE`, so concurrent refreshes of the same account keep one row, and records `account.managed` or `account.unmanaged` for every change. Only standard and guest accounts other than the instance owner count, and only providers whose setup is finished. Every path that links or unlinks identities, changes provider domains, creates an account, changes an e-mail address or transfers the instance ownership calls it in its transaction.
- `refuseManaged(executor, accountId, which)` throws `ManagedAccountError` (problem `managedAccount`): `any` for every managed account (password sign-in, change and re-authentication, e-mail change, passkey sign-in), `providerOnly` for accounts managed through OIDC or SAML (TOTP and passkey setup and re-authentication, recovery codes, second-factor reset). Password reset requests send no link to managed accounts, and password reset and e-mail change links are refused as `invalidToken` once the account is managed (`managedStateOf`).
- `takeOverLocalCredentials` runs after a provider sign-in, after **Link identity** and after the automatic link of an existing account, and does nothing unless the account is managed through an identity and still has a local sign-in. It deletes the password and, except for LDAP, the TOTP secret, passkeys and recovery codes, and also sessions, pending challenges and account tokens, records `account.localCredentialsRemoved` and queues the mail `accountManaged`.
- `secondFactorRequirement` returns no requirement for accounts managed through OIDC or SAML; the instance owner always needs one.

## Re-authentication

Routes declare `recentAuthentication` in `@SessionRoute` or `@Permission`. The global guard (`apps/api/src/access/route-access.guard.ts`) answers `403` with `reauthenticationRequired` unless the session was authenticated within `auth.reauthenticationMinutes`.

- `POST /api/v1/auth/reauthenticate` confirms with the password, a TOTP code or a passkey (options from `POST /api/v1/auth/reauthenticate/passkey-options`). Managed accounts are refused for the password, accounts managed through OIDC or SAML for every method.
- `POST /api/v1/auth/reauthenticate/provider` starts a fresh sign-in at the provider linked to the account: `prompt=login` and `max_age=0` for OIDC, `ForceAuthn` for SAML. Lunedo checks that `auth_time` (or `AuthnInstant`) is at most 60 seconds older than the start of the flow, that the identity belongs to the session's account and, with `providerProof`, that the provider proved a second factor.
- `POST /api/v1/auth/reauthenticate/directory` confirms with the password of a linked directory.

The session ID changes after every re-authentication. Failed re-authentications count as sign-in failures.

## CSRF protection

State-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`) must carry the header `X-Lunedo-Request: 1` and an `Origin` header equal to the instance URL (`apps/api/src/app.ts`).

- Before the instance URL is set during setup, the origin must match the host the request was sent to. Until setup is complete, setup requests also pass with the origin the setup session was started from, and starting the setup session passes with the origin of the host the request was sent to, so a wrong instance URL can still be corrected.
- A request that carries the header and the origin of the host it was sent to, while the instance URL names another origin, is answered with `403` and `instanceMoved`, with the current instance URL in the problem.
- Other requests are answered with `403` and `csrfRejected`.

Exceptions:

- Requests with an API token and without session cookies, because browsers do not attach tokens on their own. A request with both an API token and a session cookie is refused with `ambiguousCredentials`.
- Back-channel logout requests without cookies; the signed logout token authenticates them.
- SAML responses at `POST /api/v1/auth/providers/{providerId}/saml/acs`; the identity provider posts them from another origin. They only complete a flow in the browser that holds the matching provider cookie, or, with sign-in started at the identity provider allowed, start a new one.
- One-click unsubscribe (`POST /api/v1/notifications/unsubscribe/{token}`), which mail clients send without an origin; the token in the address authenticates it.

## Endpoints

All endpoints are internal: they serve the web client and are not part of the public API documentation.

| Endpoint | Access |
|---|---|
| `GET /api/v1/auth/sign-in-options`, `POST /api/v1/auth/sign-in/discover` | public |
| `POST /api/v1/auth/sign-in` | public |
| `POST /api/v1/auth/sign-in/second-factor`, `…/second-factor/passkey-options` | pending sign-in |
| `POST /api/v1/auth/sign-in/passkey-options`, `POST /api/v1/auth/sign-in/passkey` | public |
| `POST /api/v1/auth/providers/{providerId}/start`, `GET …/callback`, `POST …/password` | public |
| `GET …/saml/metadata`, `POST …/saml/acs` | public |
| `POST /api/v1/auth/providers/{providerId}/backchannel-logout` | public, signed logout token |
| `GET /api/v1/auth/link`, `POST /api/v1/auth/link`, `…/link/passkey-options`, `…/link/provider`, `…/link/directory`, `…/link/decline` | link cookie |
| `GET /api/v1/auth/session`, `POST /api/v1/auth/sign-out` | session |
| `POST /api/v1/auth/reauthenticate`, `…/reauthenticate/passkey-options`, `…/reauthenticate/provider`, `…/reauthenticate/directory` | session |
| `POST /api/v1/auth/password-reset`, `…/password-reset/complete` | public |
| `POST /api/v1/auth/email-change/confirm` | public, with the token from the mail |
| `GET /api/v1/account/security` | session; includes `managedBy`, the managing provider or `null` |
| `POST /api/v1/account/password`, `POST /api/v1/account/email` | session, recent authentication |
| `POST /api/v1/account/totp`, `…/totp/confirm`, `DELETE /api/v1/account/totp` | session, recent authentication |
| `POST /api/v1/account/passkeys/registration-options`, `POST /api/v1/account/passkeys`, `DELETE /api/v1/account/passkeys/{id}` | session, recent authentication |
| `POST /api/v1/account/recovery-codes` | session, recent authentication |
| `GET /api/v1/account/sessions`, `DELETE /api/v1/account/sessions/{id}`, `POST /api/v1/account/sessions/end-others` | session |
| `GET /api/v1/account/identities` | session |
| `DELETE /api/v1/account/identities/{identityId}` | session, recent authentication |
| `GET /api/v1/account/withheld-roles` | session |
| `GET /api/v1/accounts/{accountId}/identities` | `account.identities.view` |
| `POST /api/v1/accounts/{accountId}/identities`, `DELETE …/identities/{identityId}` | `account.identities.manage`, recent authentication |
| `POST /api/v1/accounts/{accountId}/second-factor/reset` | `account.secondFactor.reset`, recent authentication |

The second-factor routes for setting up TOTP and passkeys also accept setup sessions. Most `account` routes also accept portal accounts.

## Problem codes

Errors are Problem Details (RFC 9457) with a stable `type` such as `urn:lunedo:problem:invalidCredentials` and the same value as `code`.

| Code | Meaning |
|---|---|
| `invalidCredentials` | Wrong address or password; unknown addresses get the same answer. |
| `invalidSecondFactor` | Wrong TOTP code, recovery code or passkey. |
| `locked` | The address or client is locked; comes with `Retry-After`. |
| `rateLimited` | Too many attempts; comes with `Retry-After`. |
| `challengeExpired` | The pending sign-in, provider flow or link expired or was used; start again. |
| `setupIncomplete` | The instance is not set up yet. |
| `passwordPolicy` | The new password is too short, too long or too common. |
| `invalidToken` | The reset or confirmation link is not valid or has expired. |
| `sameEmail` | The new e-mail address is the current one. |
| `noSecondFactor`, `secondFactorExists`, `lastSecondFactor` | The factor change is not possible in the current state. |
| `reauthenticationRequired` | The route needs a recent re-authentication. |
| `secondFactorSetupRequired` | The session may only set up a second factor. |
| `notSignedIn` | The route needs a session. |
| `managedAccount` | The account is managed by an identity provider; the problem carries `providerId` and `providerName`. |
| `lastSignInMethod`, `managedIdentity`, `identityInUse` | Unlinking or linking an identity is not possible: the last way to sign in, the identity of the managing provider, or an identity linked elsewhere. |
| `accountNotActive` | Unlinking the last identity would make a deactivated account local. |
| `providerUnavailable` | The provider or directory could not be reached or did not answer acceptably. |
| `providerDeactivated` | The provider is deactivated. |
| `providerInitiatedSignIn` | A SAML response without a started sign-in, while sign-in started at the identity provider is off. |
| `passwordExpired`, `passwordMustChange`, `accountLocked`, `accountDisabled`, `outsideSignInHours` | The directory refused the account for this reason. |
| `signInPaused` | Sign-in is paused during maintenance. |
| `csrfRejected`, `instanceMoved`, `ambiguousCredentials` | See [CSRF protection](#csrf-protection). |
