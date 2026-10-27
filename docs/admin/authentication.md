# Authentication

Local accounts sign in with e-mail address and password, followed by a second factor if the account has one, or without a password with a passkey. People can also sign in through [identity providers](identity-providers.md); the sign-in page asks for the e-mail address first and chooses the provider by its domain.

This page lists the rules and settings for accounts, passwords, second factors, lockouts and sessions. How the browser and the API carry out a sign-in is described for developers in the repository.

## Accounts

Accounts have a type (standard, guest, portal, service) and a state (invited, active, deactivated, anonymized, placeholder). Only active standard, guest and portal accounts sign in interactively; service accounts use API tokens only (see [Service accounts](service-accounts.md)). Accounts are never deleted. See [Accounts](accounts.md) for managing them.

E-mail addresses are stored as entered and are unique regardless of case: `Ana@example.com` and `ana@example.com` cannot belong to two accounts, and both sign in to the same one.

The instance records its owner, the account created during setup. The owner always needs a second factor and is the break-glass account that can sign in with its password when identity providers fail.

## Passwords

- Passwords are hashed with Argon2id at 19 MiB memory, 2 iterations and 1 lane, the recommendation of the OWASP Password Storage Cheat Sheet. Each hash records its parameters. When the parameters change, the hash is replaced at the next successful sign-in.
- At most `LUNEDO_PASSWORD_HASH_CONCURRENCY` hashes are computed at once per process: 4 by default, at most 64, each needing about 19 MiB of memory (see [Configuration](configuration.md)). Further requests wait in a short queue; beyond it they are answered with `503` and `Retry-After`.
- The minimum length is the setting **Minimum password length**, 12 by default, at least 8. Passwords longer than 256 characters are refused. There are no composition rules. Passwords on a bundled list of about 38,000 common passwords are refused; the check runs locally, nothing is sent anywhere.
- A forgotten password is reset with a link sent by e-mail. The link holds a single-use token that is valid for 30 minutes; only its hash is stored. The request is answered the same way whether the address belongs to an account or not, because the lookup runs in a background job. A reset ends all sessions of the account and clears its failed sign-ins.
- Changing the password requires a recent re-authentication and ends all other sessions.
- Changing the e-mail address requires a recent re-authentication. The new address receives a confirmation link that is valid for 24 hours; the old address receives a notice once the change is confirmed. If the new address already belongs to another account, it receives a notice instead of a link, so the answer does not reveal the account. An account can request 5 changes per hour, and an address receives at most 3 such mails per hour.

## Second factors

- **Authenticator app (TOTP)** works with any authenticator app (SHA-1, 6 digits, 30 seconds). The secret is stored encrypted (see [Encryption](encryption.md)). Codes of one step before and after the current one are accepted, and each code is accepted once only.
- **Passkeys and security keys** use WebAuthn. The relying party ID is the host name of the instance URL, so passkeys stop working when the instance moves to another host (see [Instance address](instance-address.md)). A passkey works as second factor and, with user verification, for sign-in without a password, which counts as both factors.
- **Recovery codes**: ten single-use codes, stored as hashes, created with the first second factor. Creating new codes invalidates the old ones. Signing in with a recovery code sends an e-mail to the account.
- **Require two-factor authentication** requires a second factor for every account. An account without one gets a session that can only set up a second factor; it becomes a full session as soon as the factor is confirmed. While a second factor is required, the last one cannot be removed.
- Adding or removing a factor and creating recovery codes require a recent re-authentication.

People manage their own factors in **Settings › My account › Sign-in and security**.

An administrator can reset the second factor of another account, for example after a lost phone, with **Reset second factor** and a reason on the account page (see [Accounts](accounts.md)). It needs a recent re-authentication. The reset removes all authenticator apps, passkeys and recovery codes, ends all sessions and sends the account an e-mail with the reason. At the next sign-in the account gets a session that can only set up a second factor, even where second factors are not required. Owners can only be reset by owners, and nobody can reset their own second factor this way; recovery codes serve that purpose. The reset is recorded in the [audit log](audit-log.md) with the reason.

## Sign-in

A password sign-in that needs a second factor creates a pending sign-in. It is valid for five minutes, allows nothing but the second step and ends after five wrong attempts.

Unknown addresses get the same answer as wrong passwords. Sign-in is not possible before setup is complete.

Sign-in through identity providers, linking of identities and the emergency sign-in of the instance owner are described in [identity-providers.md](identity-providers.md). When the instance turns `auth.passwordSignIn` off, a correct password is answered with `403` and the code `passwordSignInDisabled`, except for the instance owner.

### Rate limits and lockouts

Attempts are limited per account address and per client, and failures lock temporarily. Unknown addresses are counted like known ones. All counters are in PostgreSQL, so they apply across all nodes. IPv6 clients are counted per /64 network.

The settings are instance settings in **Settings › Instance › People and sign-in › Policies**, section **Protection against attacks**:

| Setting | Key | Default | Range |
|---|---|---|---|
| Sign-in attempts per account | `auth.signInAttemptsPerAccountPerMinute` | 10 per minute | 1 to 1000 |
| Sign-in attempts per client | `auth.signInAttemptsPerClientPerMinute` | 30 per minute | 1 to 10,000 |
| Failures before an account is locked | `auth.lockoutFailuresPerAccount` | 5 | 3 to 1000 |
| Failures before a client is locked | `auth.lockoutFailuresPerClient` | 20 | 3 to 10,000 |
| Lockout window | `auth.lockoutWindowMinutes` | 15 minutes | 1 minute to 1 day |
| First lockout | `auth.lockoutMinutes` | 1 minute | 1 minute to 1 day |
| Maximum lockout | `auth.lockoutMaxMinutes` | 60 minutes | 1 minute to 7 days |

The attempt limits count every attempt per minute, successful or not. Failures within the lockout window lock the address or the client. Each further lockout within a day doubles the lockout, up to the maximum.

Wrong second factors and failed re-authentications count as failures. A successful sign-in clears the failures of the address, not those of the client. Sign-ins with a directory password are counted in the same way, per directory and sign-in name.

A lockout ends on its own. Every lockout is recorded in the audit log as `auth.lockedOut`, with the number of failures and the end of the lockout. Administrators find it in the [audit log](audit-log.md) with the filter, and for one account on the tab **Activity** of the account in **Settings › Instance › People and sign-in › Accounts**. A password reset clears the failures of the address.

### Client address

The client address comes from `X-Forwarded-For` and the protocol from `X-Forwarded-Proto` only when the request arrives from a proxy listed in `LUNEDO_TRUSTED_PROXIES`. Otherwise the address of the connection is used. See [Reverse proxy](reverse-proxy.md).

## Sessions

Sessions are stored in PostgreSQL. The browser holds a random 256-bit session ID in the cookie `__Host-lunedo-session` (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`); the database stores only its SHA-256 hash. The session ID changes at sign-in, after the second factor and after every re-authentication.

Browsers store `Secure` cookies only over HTTPS, with `localhost` as the exception, so signing in requires HTTPS. Put Lunedo behind a reverse proxy with TLS and list the proxy in `LUNEDO_TRUSTED_PROXIES` (see [TLS and the instance address](reverse-proxy.md#tls-and-the-instance-address)).

Each session records when it was created and last used, the client address, browser and operating system, and the sign-in methods. The time of last use is written at most once a minute.

The cookie `__Host-lunedo-device` identifies the browser. A new sign-in from the same browser replaces its previous session.

People see and end their own sessions in **Settings › My account › Sign-in and security**. Administrators see and end the sessions of an account on the account page.

A background job removes expired sessions, pending sign-ins, used and expired tokens and old rate limit counters every ten minutes.

## Re-authentication

Sensitive actions, such as changing the password or a second factor, require that the person confirmed their identity within **Confirmation for sensitive changes**. Otherwise Lunedo asks for the password, an authenticator code or a passkey. Accounts without a password confirm through their provider, which signs them in again, or with their directory password.

## Settings for the instance and organizations

These settings can be set for the instance in **Settings › Instance › People and sign-in › Policies**, section **Sign-in**, and for an organization in **Settings › Organization › Integrations and security › Security**, section **Sign-in**:

| Setting | Key | Default | Range |
|---|---|---|---|
| Require two-factor authentication | `auth.twoFactorRequired` | Off | |
| Minimum password length | `auth.passwordMinLength` | 12 | 8 to 256 characters |
| Confirmation for sensitive changes | `auth.reauthenticationMinutes` | 10 minutes | 1 to 60 minutes |
| Sign out after inactivity | `auth.sessionIdleTimeoutMinutes` | 10080 minutes (7 days) | 5 minutes to 365 days |
| Maximum session length | `auth.sessionLifetimeMinutes` | 43200 minutes (30 days) | 5 minutes to 365 days |
| Sessions per account | `auth.maxSessionsPerAccount` | 10 | 1 to 100 |

A new session beyond **Sessions per account** ends the least recently used one.

Organizations can only make these settings stricter: require a second factor, demand a longer password, or allow shorter times and fewer sessions. A value that is less strict than the instance value is refused. When the instance later becomes stricter than a stored organization value, the instance value applies, and the organization's value shows as overridden. An organization's values apply to the accounts whose home organization it is.

The instance can lock each of these settings with **Lock for organizations**; organizations then cannot change it. Each setting shows whether its value is inherited or set at this level, and can be reset to the inherited value.
