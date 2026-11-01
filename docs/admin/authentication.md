# Authentication

Local accounts sign in with e-mail address and password, followed by a second factor if the account has one, or without a password with a passkey. Accounts managed by an [identity provider](identity-providers.md) sign in only through it; the sign-in page asks for the e-mail address first and chooses the provider by its domain. What people see is described in [Sign-in and security](../user/sign-in-and-security.md).

This page lists the rules and settings for accounts, passwords, second factors, lockouts and sessions. How the browser and the API carry out a sign-in is described for developers in the repository.

## Accounts

Accounts have a type (standard, guest, portal, service) and a state (invited, active, deactivated, anonymized, placeholder). Only active standard, guest and portal accounts sign in interactively; service accounts use API tokens only (see [Service accounts](service-accounts.md)). Accounts are never deleted. See [Accounts](accounts.md) for managing them.

E-mail addresses are stored as entered and are unique regardless of case: `Ana@example.com` and `ana@example.com` cannot belong to two accounts, and both sign in to the same one.

An account is local or [managed](identity-providers.md#managed-accounts) by an identity provider. Managed accounts do not use a Lunedo password; accounts managed through OIDC or SAML have no second factor in Lunedo either. The rules below for passwords and second factors apply to local accounts, and the rules for second factors also to accounts managed through LDAP.

The instance records its owner, the account created during setup. The owner's account is never managed, always needs a second factor and is the break-glass account that can sign in with its password when identity providers fail (see [Emergency sign-in](identity-providers.md#emergency-sign-in)).

## Passwords

- Passwords are hashed with Argon2id at 19 MiB memory, 2 iterations and 1 lane, the recommendation of the OWASP Password Storage Cheat Sheet. Each hash records its parameters. When the parameters change, the hash is replaced at the next successful sign-in.
- At most `LUNEDO_PASSWORD_HASH_CONCURRENCY` hashes are computed at once per process: 4 by default, at most 64, each needing about 19 MiB of memory (see [Configuration](configuration.md)). Further requests wait in a short queue; beyond it they are answered with `503` and `Retry-After`.
- The minimum length is the setting **Minimum password length**, 12 by default, at least 8. Passwords longer than 256 characters are refused. There are no composition rules. Passwords on a bundled list of about 38,000 common passwords are refused; the check runs locally, nothing is sent anywhere.
- A forgotten password is reset with a link sent by e-mail. The link holds a single-use token that is valid for 30 minutes; only its hash is stored. The request is answered the same way whether the address belongs to an account or not, because the lookup runs in a background job. A reset ends all sessions of the account and clears its failed sign-ins. Local standard and guest accounts without a password receive a link as well, so they can set one. Managed accounts receive no link, also while their provider is deactivated.
- Changing the password requires a recent re-authentication and ends all other sessions. Managed accounts are refused with `managedAccount`.
- Changing the e-mail address requires a recent re-authentication. The new address receives a confirmation link that is valid for 24 hours; the old address receives a notice once the change is confirmed. If the new address already belongs to another account, it receives a notice instead of a link, so the answer does not reveal the account. An account can request 5 changes per hour, and an address receives at most 3 such mails per hour. The address of a managed account comes from its provider; changing it in Lunedo is refused with `managedAccount`.

## Second factors

- **Authenticator app (TOTP)** works with any authenticator app (SHA-1, 6 digits, 30 seconds). The secret is stored encrypted (see [Encryption](encryption.md)). Codes of one step before and after the current one are accepted, and each code is accepted once only.
- **Passkeys and security keys** use WebAuthn. The relying party ID is the host name of the instance URL, so passkeys stop working when the instance moves to another host (see [Instance address](instance-address.md)). A passkey works as second factor and, with user verification, for sign-in without a password, which counts as both factors.
- **Recovery codes**: ten single-use codes, stored as hashes, created with the first second factor. Creating new codes invalidates the old ones. Signing in with a recovery code sends an e-mail to the account.
- **Require two-factor authentication** requires a second factor for every account. An account without one gets a session that can only set up a second factor; it becomes a full session as soon as the factor is confirmed. While a second factor is required, the last one cannot be removed. It does not apply to accounts managed through OIDC or SAML; their provider handles the second factor.
- Adding or removing a factor and creating recovery codes require a recent re-authentication. Accounts managed through OIDC or SAML cannot add factors or create recovery codes; they are refused with `managedAccount`.

People manage their own factors in **Settings › My account › Sign-in and security**.

An administrator can reset the second factor of another account, for example after a lost phone, with **Reset second factor** and a reason on the account page (see [Accounts](accounts.md)). It needs a recent re-authentication. The reset removes all authenticator apps, passkeys and recovery codes, ends all sessions and sends the account an e-mail with the reason. At the next sign-in the account gets a session that can only set up a second factor, even where second factors are not required. Owners can only be reset by owners, and nobody can reset their own second factor this way; recovery codes serve that purpose. The reset is recorded in the [audit log](audit-log.md) with the reason. It is refused with `managedAccount` for accounts managed through OIDC or SAML.

## Sign-in

A password sign-in that needs a second factor creates a pending sign-in. It is valid for five minutes, allows nothing but the second step and ends after five wrong attempts.

Unknown addresses get the same answer as wrong passwords. Sign-in is not possible before setup is complete.

A password or passkey sign-in of a managed account is refused. A correct password is answered with `403` and the code `managedAccount`, which names the provider; a wrong one gets the same answer as any wrong password.

Sign-in through identity providers, linking of identities and the emergency sign-in of the instance owner are described in [identity-providers.md](identity-providers.md).

### Rate limits and lockouts

Attempts are limited per account address and per client, and failures lock temporarily. Unknown addresses are counted like known ones. All counters are in PostgreSQL, so they apply across all nodes. IPv6 clients are counted per /64 network.

The settings are instance settings in **Settings › Instance › People and sign-in › Policies**, section **Protection against attacks**.

The attempts are counted per minute, the lockout window and the lockouts in minutes. The [Settings reference](settings-reference.md#instance--people-and-sign-in--policies) lists each setting with its key, default and allowed values.

The limit per account counts every attempt per minute, successful or not. The limit per client counts only failed attempts, so many people behind one address, such as an office behind NAT, can sign in at the same time: 250 people from one address within a few minutes are not slowed down by the defaults, while wrong passwords from that address are still limited and lock it. Every attempt reserves a place in the failure count of its client when it starts and gives it back when it succeeds, so wrong passwords that arrive at the same moment cannot exceed the limit. Attempts that are still being checked hold their place: more simultaneous attempts than the limit from one address are answered with `429` until some of them finish. Independent of the outcome, one client can make at most 300 sign-in attempts per minute. Failures within the lockout window lock the address or the client. Each further lockout within a day doubles the lockout, up to the maximum.

The instance owner is the exception for the password step: attempts and wrong passwords for the owner's address count only per client, never for the account itself, so nobody can lock the owner out of the emergency sign-in by sending wrong passwords for the owner's address. Second factors still count for the owner's account as well: every attempt towards the attempts per minute, every wrong one towards the lockout, also when an identity is linked to the owner's account.

Wrong second factors and failed re-authentications count as failures. A successful sign-in clears the failures of the address, not those of the client. Sign-ins with a directory password are counted in the same way, per directory and sign-in name.

Other steps of the sign-in have fixed limits per client. Choosing the provider by the e-mail address, starting a sign-in through an identity provider and passkey options allow 300 requests per minute each, which only stops floods. Answers of a SAML provider and logout requests from a provider count only when they are invalid: 20 invalid SAML answers and 60 invalid logout requests per minute. A SAML answer that belongs to a sign-in you started is checked when the browser returns to Lunedo: it counts as invalid if that check fails or the browser never returns, and it stops counting once the answer has passed the check.

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

Sensitive actions, such as changing the password or a second factor, require that the person confirmed their identity within **Confirmation for sensitive changes**. Otherwise Lunedo asks for the password, an authenticator code or a passkey. Accounts managed through OIDC or SAML confirm only through their provider, which signs them in again. Accounts managed through LDAP confirm with their directory password, an authenticator code or a passkey.

## Settings for the instance and organizations

These settings can be set for the instance in **Settings › Instance › People and sign-in › Policies**, section **Sign-in**, and for an organization in **Settings › Organization › Integrations and security › Security**, section **Sign-in**.

Durations are in minutes, the minimum password length in characters. The settings reference lists each setting with its key, default and allowed values, for the [instance](settings-reference.md#instance--people-and-sign-in--policies) and for [organizations](settings-reference.md#organization--integrations-and-security--security).

A new session beyond **Sessions per account** ends the least recently used one.

Organizations can only make these settings stricter: require a second factor, demand a longer password, or allow shorter times and fewer sessions. A value that is less strict than the instance value is refused. When the instance later becomes stricter than a stored organization value, the instance value applies, and the organization's value shows as overridden. An organization's values apply to the accounts whose home organization it is.

The instance can lock each of these settings with **Lock for organizations**; organizations then cannot change it. Each setting shows whether its value is inherited or set at this level, and can be reset to the inherited value.
