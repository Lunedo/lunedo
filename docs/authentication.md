# Authentication

Local accounts sign in with e-mail address and password, followed by a second factor if the account has one, or without a password with a passkey. People can also sign in through identity providers; the sign-in page asks for the e-mail address first and chooses the provider by its domain.

## Accounts

Accounts have a type (`standard`, `guest`, `portal`, `service`) and a state (`invited`, `active`, `deactivated`, `anonymized`, `placeholder`). Only active standard, guest and portal accounts sign in interactively; service accounts use API tokens only. Accounts are never deleted.

E-mail addresses are stored as entered and are unique regardless of case: `Ana@Example.org` and `ana@example.org` cannot belong to two accounts, and both sign in to the same one.

The instance records its owner, the account created during setup. The owner always needs a second factor and is the break-glass account that can sign in with its password when identity providers fail.

## Passwords

- Passwords are hashed with Argon2id at 19 MiB memory, 2 iterations and 1 lane, the recommendation of the OWASP Password Storage Cheat Sheet. Each hash records its parameters. When the parameters change, the hash is replaced at the next successful sign-in.
- At most `LUNEDO_PASSWORD_HASH_CONCURRENCY` hashes are computed at once per process. Further requests wait in a short queue; beyond it they are answered with `503` and `Retry-After`. Passwords longer than 256 characters are rejected before hashing.
- The minimum length is the setting `auth.passwordMinLength` (default 12, at least 8). There are no composition rules. Passwords on a bundled list of about 38,000 common passwords are rejected; the check runs locally, nothing is sent anywhere.
- A forgotten password is reset with a link sent by e-mail. The link holds a single-use token that is valid for 30 minutes; only its hash is stored. The request is answered the same way whether the address belongs to an account or not, because the lookup runs in a background job. A reset ends all sessions of the account and clears its failed sign-ins.
- Changing the password requires a recent re-authentication and ends all other sessions.
- Changing the e-mail address requires a recent re-authentication. The new address receives a confirmation link that is valid for 24 hours; the old address receives a notice once the change is confirmed. If the new address already belongs to another account, it receives a notice instead of a link, so the answer does not reveal the account. An account can request 5 changes per hour, and an address receives at most 3 such mails per hour.

## Second factors

- **TOTP** works with any authenticator app (SHA-1, 6 digits, 30 seconds). The secret is stored with envelope encryption. Codes of one step before and after the current one are accepted, and each code is accepted once only.
- **Passkeys and security keys** use WebAuthn. The relying party ID is the host name of the instance URL, so passkeys stop working when the instance moves to another host. A passkey works as second factor and, with user verification, for sign-in without a password, which counts as both factors.
- **Recovery codes**: ten single-use codes, stored as hashes, created with the first second factor. Creating new codes invalidates the old ones. Signing in with a recovery code sends an e-mail to the account.
- The setting `auth.twoFactorRequired` requires a second factor for every account. An account without one gets a session that can only set up a second factor; it becomes a full session as soon as the factor is confirmed. While a second factor is required, the last one cannot be removed.
- Adding or removing a factor and creating recovery codes require a recent re-authentication.
- An administrator can reset the second factor of another account, for example after a lost phone: `POST /api/v1/accounts/{accountId}/second-factor/reset` with a reason. It needs the permission `account.secondFactor.reset` (instance accounts area, or administration of the account's home organization) and a recent re-authentication. The reset removes all authenticator apps, passkeys and recovery codes, ends all sessions and sends the account an e-mail with the reason. At the next sign-in the account gets a session that can only set up a second factor, even where second factors are not required. The reset is audited as `account.secondFactorReset` with the reason.
- Rank rules for the reset: holders of instance roles can only be reset by someone who holds at least the same instance areas, the instance owner only by owners, owners of the account's home organization only by owners of that organization or by the instance owner, and other members by administrators of their home organization or of the instance. Nobody can reset their own second factor this way; recovery codes serve that purpose.

## Sign-in

1. `POST /api/v1/auth/sign-in` with e-mail address and password. Without a second factor, the answer creates the session. Otherwise it creates a pending sign-in that is valid for five minutes, allows nothing but the second step and ends after five wrong attempts.
2. `POST /api/v1/auth/sign-in/second-factor` with a TOTP code, a recovery code or a passkey assertion (options from `POST /api/v1/auth/sign-in/second-factor/passkey-options`).

Passwordless sign-in: `POST /api/v1/auth/sign-in/passkey-options`, then `POST /api/v1/auth/sign-in/passkey`.

Unknown addresses take the same time and get the same answer as wrong passwords. Sign-in is not possible before setup is complete.

Sign-in through identity providers, linking of identities and the emergency sign-in of the instance owner are described in [identity-providers.md](identity-providers.md). When the instance turns `auth.passwordSignIn` off, a correct password is answered with `403` and the code `passwordSignInDisabled`, except for the instance owner.

### Rate limits and lockouts

Attempts are limited per account address and per client, and failures lock temporarily. Unknown addresses are counted like known ones. All counters are in PostgreSQL, so they apply across all nodes. IPv6 clients are counted per /64 network.

| Setting | Default | Meaning |
|---|---|---|
| `auth.signInAttemptsPerAccountPerMinute` | 10 | Sign-in attempts per address and minute, successful or not |
| `auth.signInAttemptsPerClientPerMinute` | 30 | Sign-in attempts per client and minute |
| `auth.lockoutFailuresPerAccount` | 5 | Failures of one address within the window that lock it |
| `auth.lockoutFailuresPerClient` | 20 | Failures of one client within the window that lock it |
| `auth.lockoutWindowMinutes` | 15 | Period in which failures count |
| `auth.lockoutMinutes` | 1 | First lockout; each further lockout within a day doubles it |
| `auth.lockoutMaxMinutes` | 60 | Longest lockout |

Wrong second factors and failed re-authentications count as failures. A successful sign-in clears the failures of the address, not those of the client.

### Client address

The client address comes from `X-Forwarded-For` and the protocol from `X-Forwarded-Proto` only when the request arrives from a proxy listed in `LUNEDO_TRUSTED_PROXIES`. Otherwise the address of the connection is used.

## Sessions

Sessions are stored in PostgreSQL. The browser holds a random 256-bit session ID in the cookie `__Host-lunedo-session` (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`); the database stores only its SHA-256 hash. The session ID changes at sign-in, after the second factor and after every re-authentication.

Browsers store `Secure` cookies only over HTTPS, with `localhost` as the exception, so signing in requires HTTPS. Put Lunedo behind a reverse proxy with TLS and list the proxy in `LUNEDO_TRUSTED_PROXIES`.

Each session records when it was created and last used, the client address, browser and operating system, and the sign-in methods. The time of last use is written at most once a minute.

The cookie `__Host-lunedo-device` identifies the browser. A new sign-in from the same browser replaces its previous session.

| Setting | Default | Meaning |
|---|---|---|
| `auth.maxSessionsPerAccount` | 10 | A new session beyond the limit ends the least recently used one |
| `auth.sessionIdleTimeoutMinutes` | 10080 (7 days) | A session ends after this time without use |
| `auth.sessionLifetimeMinutes` | 43200 (30 days) | A session ends at the latest after this time |
| `auth.reauthenticationMinutes` | 10 | How long a re-authentication allows sensitive actions |

These settings, `auth.passwordMinLength` and `auth.twoFactorRequired` can be set for the instance and for organizations. Organizations can only make them stricter.

A background job removes expired sessions, pending sign-ins, used and expired tokens and old rate limit counters every ten minutes.

## Re-authentication

Sensitive actions answer `403` with the code `reauthenticationRequired` unless the session was authenticated within `auth.reauthenticationMinutes`. `POST /api/v1/auth/reauthenticate` confirms the identity with the password, a TOTP code or a passkey; accounts without a password confirm it through their provider (`POST /api/v1/auth/reauthenticate/provider`).

## CSRF protection

State-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`) must carry the header `X-Lunedo-Request: 1` and an `Origin` header equal to the instance URL. Before the instance URL is set during setup, the origin must match the host the request was sent to. Until setup is complete, setup requests also pass with the origin the setup session was started from, and entering the setup code passes with the origin of the host the request was sent to, so a wrong instance URL can still be corrected. Other requests are answered with `403` and the code `csrfRejected`. Requests with an API token and without session cookies are exempt, because browsers do not attach tokens on their own (see [api.md](api.md)). Back-channel logout requests of identity providers without cookies are exempt too; they are authenticated by the signed logout token.

## Endpoints

All endpoints are internal: they serve the web client and are not part of the public API documentation.

| Endpoint | Access |
|---|---|
| `POST /api/v1/auth/sign-in` | public |
| `POST /api/v1/auth/sign-in/second-factor`, `.../second-factor/passkey-options` | pending sign-in |
| `POST /api/v1/auth/sign-in/passkey-options`, `POST /api/v1/auth/sign-in/passkey` | public |
| `GET /api/v1/auth/session`, `POST /api/v1/auth/sign-out` | session |
| `POST /api/v1/auth/reauthenticate`, `.../reauthenticate/passkey-options` | session |
| `POST /api/v1/auth/password-reset`, `.../password-reset/complete` | public |
| `POST /api/v1/auth/email-change/confirm` | public, with the token from the mail |
| `GET /api/v1/account/security` | session |
| `POST /api/v1/account/password`, `POST /api/v1/account/email` | session, recent authentication |
| `POST /api/v1/account/totp`, `.../totp/confirm`, `DELETE /api/v1/account/totp` | session, recent authentication |
| `POST /api/v1/account/passkeys/registration-options`, `POST /api/v1/account/passkeys`, `DELETE /api/v1/account/passkeys/{id}` | session, recent authentication |
| `POST /api/v1/account/recovery-codes` | session, recent authentication |
| `GET /api/v1/account/sessions`, `DELETE /api/v1/account/sessions/{id}`, `POST /api/v1/account/sessions/end-others` | session |

Errors are Problem Details (RFC 9457) with a stable `type` such as `urn:lunedo:problem:invalidCredentials` and the same value as `code`, for example `invalidCredentials`, `invalidSecondFactor`, `locked`, `rateLimited`, `challengeExpired`, `passwordPolicy`, `reauthenticationRequired` or `secondFactorSetupRequired`. `locked` and `rateLimited` come with `Retry-After`.
