# Changelog

What changed for the people who run and use Lunedo. Each release lists its changes in the groups New, Improved, Fixed, Breaking changes and Manual steps. A release that cannot be reached from every earlier version says from which version to update. The admin area and the update command read this file; [docs/development/changelog.md](docs/development/changelog.md) describes the format.

## Unreleased

### New

- A system status page for instance administrators that says for every check whether it is ok, what is wrong and where it is fixed.
- Maintenance mode makes the instance read-only with a message for everyone and can pause signing in for everyone except instance administrators.
- An optional update check shows new versions with their changes and the commands to update.
- A setup script installs Lunedo with Docker Compose and updates it with one command, with a backup before every update.
- Prometheus metrics for backups, jobs, mail delivery, storage, the collaboration server, maintenance mode and available updates.
- Documentation and tested examples for Caddy, Nginx and Traefik in front of Lunedo.
- Managed accounts: an account linked to an identity provider, or whose e-mail domain belongs to one, signs in only through that provider. Existing local accounts are taken over at their first sign-in through the provider; their Lunedo credentials are removed and the person gets an e-mail. Accounts with a role above member confirm that link once with their password or passkey and second factor.
- Administrators make a managed account local again by unlinking its last identity; the person gets an e-mail to set a password.
- Invitations to an address in a provider's domain ask only for the name and send the person to the provider; self-registration refuses such addresses (`managedDomain`) and points to the provider.
- A user page on signing in, second factors, passkeys and sessions.
- Reference pages that list every environment variable, setting, audit event and command, generated from the code.

### Improved

- `lunedo help` describes every command and lists the exit codes; `./lunedo help` also lists `print-compose`, `help` and its exit codes.
- Every sign-in of the instance owner with password or passkey counts as emergency sign-in while an identity provider is active.
- Failed sign-ins for the instance owner's account are counted per client only, so wrong passwords sent for the owner's address cannot lock the owner out.

### Breaking changes

- The instance setting `auth.passwordSignIn` is removed. `GET /api/v1/auth/sign-in-options` no longer returns `emailStep`, `directProvider` and `passwordSignIn`, `POST /api/v1/auth/sign-in/discover` no longer answers the step `none`, and the problem `passwordSignInDisabled` is gone. Setting the key is refused.
- The second-factor mode `lunedo` of OIDC and SAML providers is removed. Providers that used it now use "Handled by the provider": sign-ins through them no longer ask for a Lunedo second factor. Set up multi-factor authentication at the provider, and choose "Require proof from the provider" if Lunedo should refuse sign-ins without that proof.
- Accounts managed by an identity provider can no longer sign in with a password or a passkey, change their password or e-mail address, or get a password reset link. Accounts managed through OIDC or SAML can no longer use authenticator apps, passkeys or recovery codes in Lunedo, and administrators cannot reset their second factor. These requests are refused with `managedAccount`.
- An identity provider with linked accounts can no longer be removed (`providerHasAccounts`); deactivate it, or move or unlink the accounts first.
- The instance ownership can only be transferred to an account that is not managed by an identity provider (`ownerManaged`).
