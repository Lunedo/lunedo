# Sign-in and security

This page explains how you sign in to Lunedo, how your account is protected and what changes when your organization's identity provider manages your account. You find your own settings under **Settings › My account › Sign-in and security**. The rules your administrators set are described in [Authentication](../admin/authentication.md) and [Identity providers](../admin/identity-providers.md).

## Signing in

The sign-in page shows a button for every identity provider of your organization, the one you used last first, and the field **Work e-mail address or sign-in name**. Enter your address and choose **Continue**. The part of the address after the `@` decides the next step:

- Your organization signs in through a provider with this domain: the page shows the button of that provider, and you sign in there.
- Your organization uses a directory (LDAP or Active Directory): the page asks for your sign-in name and password of the directory.
- Otherwise the page asks for your Lunedo password.

When your account has a second factor, or one is required, the page **Confirm it's you** follows. Enter the code from your authenticator app, use your passkey, or enter a recovery code.

**Sign in with a passkey** signs you in without an address and without a password, if you added a passkey to a local account.

After a sign-in through a provider, your browser remembers the provider for 180 days and offers it first.

After several wrong attempts, the address is locked for a short time; the lock ends on its own. When you sign in from a new browser after you have used another one, Lunedo sends you a notification.

## Local and managed accounts

Your account is either local or managed by an identity provider:

- A **local** account signs in with its Lunedo password and its own second factor in Lunedo. Guests usually have local accounts.
- A **managed** account belongs to an identity provider of your organization, such as Microsoft Entra ID, Google Workspace, another OpenID Connect or SAML provider, or a directory. It is managed when the provider created it, when your sign-in at the provider is linked to it, or when the domain of your e-mail address belongs to the provider.

| | Local account | Managed through OpenID Connect or SAML | Managed through a directory |
|---|---|---|---|
| Signing in | Lunedo password, or a passkey | Only through the provider's button | Sign-in name and password of the directory, on the Lunedo sign-in page |
| Second factor | In Lunedo: authenticator app, passkeys, recovery codes | At your provider; none in Lunedo | In Lunedo: authenticator app or passkey, recovery codes |
| Forgotten password | **Forgot password?** on the sign-in page | At your provider | At your directory |
| E-mail address | You change it yourself | Comes from the provider | Comes from the directory |

Lunedo refuses a Lunedo password, a passkey sign-in and an e-mail change for a managed account, and for accounts managed through OpenID Connect or SAML also every second factor in Lunedo. The message names the provider to use.

Under **Sign-in and security**, a managed account shows "Signed in through *provider*" with the badge **Managed** instead of the password. For OpenID Connect and SAML, the section **Two-factor authentication** is not shown; for a directory it stays. Under **Settings › My account › Profile**, the e-mail address says "From *provider*. Change it there."

When you sign in to a managed account with a password or passkey, the sign-in page shows "Sign in through *provider*" with the provider's button, or says that the provider is not available at the moment. **Use another account** returns to the start.

The owner of the instance always keeps a local account, so that someone can sign in when every provider fails.

When your administrator deactivates the provider that manages your account, you cannot sign in until it is active again or your account is moved to another provider. Lunedo does not fall back to a password and sends no password reset link; ask your administrator.

## When your account becomes managed

Your account becomes managed at your first sign-in through a provider when the provider's address for you is the address of your Lunedo account and its domain belongs to the provider. Lunedo links the sign-in to your account. If you hold a role above member, for example as an administrator, Lunedo first asks you once to confirm that the account is yours, with your Lunedo password or a passkey and your second factor. From then on:

- Through OpenID Connect or SAML: Lunedo removes your password, passkeys, authenticator app and recovery codes. Sign in through the provider; it asks for your second factor.
- Through a directory: Lunedo removes your Lunedo password. Your authenticator app and passkeys stay as second factor.
- Your other sessions end. Your content, groups, roles and memberships stay as they were.
- You receive an e-mail that your account now signs in through the provider. An administrator can also link your account; then the e-mail says so.

If your Lunedo account is already linked to another sign-in at the same provider, Lunedo cannot tell which one is yours. The sign-in is refused with a reference; send it to your administrator, who can link the right sign-in.

When you are invited with an address of such a domain, the invitation page asks only for your name, and you sign in through the provider afterwards. Registering yourself is not possible for these addresses; use the provider's button on the sign-in page.

## When your account becomes local

When an administrator unlinks your account from its last provider, and no provider has the domain of your address, the account becomes local. You receive an e-mail with a link to set a password. The link is valid for 30 minutes; after that, use **Forgot password?** on the sign-in page.

## Password

Local accounts change their password with **Change password** under **Sign-in and security**. The new password needs at least the minimum length of your instance or organization, 12 characters by default, and at most 256. Common passwords are refused. Changing the password ends your other sessions.

If you forgot your password, choose **Forgot password?** on the sign-in page and enter your address. If the address belongs to a local account, you receive a link that is valid for 30 minutes. The page answers the same way for every address. Setting a new password ends all your sessions. Managed accounts receive no link; their password belongs to the provider or the directory.

## Second factor

Under **Two-factor authentication**, local accounts and accounts managed through a directory add:

- an **Authenticator app**: scan the code with an app such as Aegis or 1Password and confirm with a code from it;
- **Passkeys**: with fingerprint, face recognition or a security key;
- **Recovery codes**: ten codes, created with your first second factor. Each code works once, when you cannot use your second factor. Signing in with a recovery code sends you an e-mail. **Create new codes** makes the old ones stop working.

When the instance or your organization requires a second factor, or an administrator reset yours, you set one up before you can use Lunedo, and you cannot remove the last one. The instance owner always needs one.

If you lost your second factor, sign in with a recovery code and set up a new one. Without recovery codes, ask an administrator to reset your second factor. Accounts managed through OpenID Connect or SAML have no second factor in Lunedo; your provider handles it.

## Passkeys

A passkey signs a local account in without a password and counts as both factors. It also works as second factor after a password or a directory password. Passkeys belong to the address of your Lunedo instance; if the instance moves to another address, add them again.

## Confirming your identity

Changing your password, e-mail address or second factor needs a recent confirmation that it is you, by default within the last 10 minutes. Lunedo asks with **Confirm your identity**:

- Local accounts confirm with their password, an authenticator code or a passkey.
- Accounts managed through OpenID Connect or SAML sign in again at their provider.
- Accounts managed through a directory confirm with the directory password, an authenticator code or a passkey.

## E-mail address

Local accounts change their address with **Change e-mail address**. Lunedo sends a confirmation link to the new address; it is valid for 24 hours, and the address changes when you open it. The old address receives a notice. The address of a managed account comes from the provider.

## Sessions

**Active sessions** lists every browser where you are signed in, with browser, operating system, address and last activity. **Sign out** ends one session; **Sign out all other sessions** ends every session except the one you are using.

By default, a session ends after 7 days without activity and after 30 days at the latest, and an account has at most 10 sessions; a new one ends the session you used least recently. Your instance or organization may set other values.

**Recent security activity** lists your sign-ins and failed sign-ins, changes of your password and second factors, ended sessions and your personal API tokens.

## Linked sign-ins

Under **Settings › My account › Profile**, **Linked sign-ins** lists the providers your account signs in through. You can unlink one while another way to sign in remains, but not the provider that manages your account; only an administrator can change that.
