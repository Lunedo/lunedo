# Identity providers

People can sign in to Lunedo with an account at an identity provider instead of a Lunedo password. An account linked to a provider is [managed](#managed-accounts) by it and signs in only through it. Lunedo supports three kinds of providers:

- OpenID Connect (OIDC), with presets for Microsoft Entra ID and Google Workspace and a generic setup for providers such as Keycloak or Authentik.
- SAML 2.0, with presets for Microsoft Entra ID and Active Directory Federation Services (ADFS) and a generic setup.
- LDAP directories, with a preset for Active Directory and a generic setup for directories such as OpenLDAP.

This page covers what all providers share. Each method has its own page for the steps at the provider.

## Which method to use

| You use | Choose in Lunedo | Page |
|---|---|---|
| Microsoft Entra ID | Microsoft Entra ID (OIDC), or SAML 2.0 with the preset Microsoft Entra ID (SAML) | [Microsoft Entra ID](identity-providers/entra-id.md) |
| Google Workspace | Google Workspace | [Google Workspace](identity-providers/google-workspace.md) |
| Keycloak, Authentik or another OIDC provider | Other OIDC provider | [OpenID Connect](identity-providers/openid-connect.md) |
| ADFS, Shibboleth or another SAML identity provider | SAML 2.0 | [SAML](identity-providers/saml.md) |
| Active Directory, OpenLDAP or another LDAP directory, without a web sign-in | LDAP or Active Directory | [LDAP and Active Directory](identity-providers/ldap.md) |

Prefer OIDC when the provider offers it. For Microsoft Entra ID, the OIDC preset reads groups and account status through Microsoft Graph with the same app registration; the SAML preset needs a second app registration for that. Use LDAP only when people have no web-based sign-in; with LDAP, people type their directory password on the Lunedo sign-in page.

What happens in the background differs by method:

| Method | Profile and groups | Background synchronization | Disabled accounts detected |
|---|---|---|---|
| Microsoft Entra ID (OIDC) | At every sign-in and synchronization | Yes | Yes |
| Microsoft Entra ID (SAML) | At every sign-in; through Graph when set up | Only with Graph access | Only with Graph access |
| Google Workspace | At every sign-in; groups only with group synchronization | Only with group synchronization | Only with "Detect suspended accounts" or domain-wide delegation |
| Other OIDC provider, generic SAML, ADFS | At every sign-in | No | No |
| LDAP and Active Directory | At every sign-in and synchronization | Yes | Yes |

Every provider can also receive changes through [SCIM](scim.md). Groups, mapping rules and synchronization are described in [Identity provider groups](identity-provider-groups.md).

## Configured for the whole instance

Providers are set up for the instance in **Settings › Instance › People and sign-in › Sign-in methods**. People who hold the instance area "Sign-in and security" with "View" see the providers; with "Manage" they change them (see [Roles and permissions](roles-and-permissions.md)). Organizations do not choose or configure sign-in methods; which organizations a person belongs to follows from the [mapping rules](identity-provider-groups.md#mapping-rules) after sign-in.

## Domains

Each provider has a list of e-mail domains, at most 50. A domain belongs to at most one provider; adding a domain another provider already has is refused. The domains:

- choose the provider on the sign-in page,
- decide which e-mail addresses count as verified: an address from the provider counts as verified only when its domain is one of the provider's domains,
- limit which people get an account at their first sign-in,
- make the accounts with an address in the domain [managed](#managed-accounts) by the provider.

Enter every domain people use at the provider, both for e-mail addresses and for sign-in names in the form `name@domain`, for example `example.com` and `nordwind.test`. Google Workspace needs at least one domain.

## Sign-in page

The sign-in page lists a button for every provider, the last used one first, and below them the field **Work e-mail address or sign-in name**. When a person enters an address, the domain, the part after the last `@`, decides the next step:

- The domain belongs to an OIDC or SAML provider: the person continues at the provider.
- The domain belongs to an LDAP provider: the page asks for the sign-in name and the password of the directory.
- No active provider has the domain, or the entry has no `@`: the page asks for the Lunedo password. Local accounts and guests sign in there.

The answer depends only on the domain and the active providers, never on whether an account with the address exists, so the page cannot be used to find out who has an account. A client can ask 30 times a minute; further questions are refused for a short time.

A managed account that reaches the password step, for example because its address is outside the provider's domains or its provider is deactivated, is refused there. Only after a correct password does the answer name the provider that manages the account; the page then shows "Sign in through *provider*" with the provider's button, or says that the provider is not available. A wrong password gets the same answer as for any address.

Further rules:

- Choosing the button of an LDAP provider opens the form for the directory sign-in name and password.
- Passkeys are always offered and work without an address. They sign in local accounts only.
- After a sign-in through a provider, the browser remembers the provider for 180 days and offers it as a shortcut next time. The cookie holds only the provider's ID.
- Deactivated providers and providers whose setup is not finished are never offered.

The button shows the provider's logo, if one is uploaded in the provider settings (PNG, JPEG or WebP, at most 256 KiB). Microsoft Entra ID and Google Workspace use their own buttons.

## Setting up a provider

1. Open **Settings › Instance › People and sign-in › Sign-in methods** and choose **Add provider**.
2. Choose the type. From the next step on, Lunedo saves the setup as a draft. You can close the assistant and continue later: the provider list shows unfinished setups under **Unfinished setups** with **Continue setup**.
3. The **Connection** step shows the values to enter at the provider first, before anything is needed from there. The draft already has the final ID of the provider, so the values do not change. Copy them, register Lunedo at the provider, and then fill in the fields below them.
4. Choose **Save and continue**. Lunedo checks the connection first: the OIDC discovery document, the SAML metadata or the directory connection. When the check fails, the assistant names the field to correct; you can also choose **Save anyway** and correct it later.
5. Choose the **User attributes**, then the settings on **Accounts**.
6. **Test** the provider (see [Testing a provider](#testing-a-provider)) and choose **Finish**. If the connection check failed before, Lunedo checks again and asks you to confirm **Finish anyway**.

Values to enter at the provider, with the instance URL `https://wiki.example.com`:

| Type | Value | Address |
|---|---|---|
| OIDC | Redirect URI | `https://wiki.example.com/api/v1/auth/providers/{provider ID}/callback` |
| SAML | Entity ID of Lunedo (identifier, audience) | `https://wiki.example.com/api/v1/auth/providers/{provider ID}/saml/metadata` |
| SAML | Assertion consumer service URL (reply URL) | `https://wiki.example.com/api/v1/auth/providers/{provider ID}/saml/acs` |
| SAML | Metadata address of Lunedo | the same address as the entity ID |
| SAML | Lunedo's signing certificate | download it in the assistant; it is also part of the metadata |
| LDAP | nothing | Lunedo connects to the directory with a service account |

The addresses use the instance URL, so set it before you register Lunedo at a provider (see [Instance address](instance-address.md)).

Until the last step is finished, the provider is not offered on the sign-in page, takes no sign-ins and is not synchronized. Test sign-ins work already. Removing a draft makes its redirect URI and certificate stop working; remove the registration at the provider as well.

The type cannot be changed once the provider is saved. Every other setting can be changed later on the provider page, in the tabs **Overview**, **Settings**, **Group mapping**, **Sync log** and **SCIM**.

## Credentials

A provider proves itself to the identity provider, or to the directory, with credentials:

| Type | Credential | Expiry |
|---|---|---|
| OIDC | A client secret from the provider's console | The expiry date you enter, or none |
| OIDC | A certificate: Lunedo creates the key pair, you upload the certificate to the provider. Lunedo authenticates with `private_key_jwt`. | 1, 2 or 3 years |
| SAML | Lunedo's signing certificate, created with the provider | 2 years by default |
| SAML, Entra ID with Graph | A client secret or certificate for Microsoft Graph, in a section of its own | As above |
| LDAP | The password of the service account | None |

Private keys never leave Lunedo. Secrets, private keys and passwords are stored encrypted (see [Encryption](encryption.md)) and are never shown again.

Renew a credential without interruption:

1. On the provider page, open **Settings** and add the new credential under **Credentials**. For a certificate, download it and register it at the provider.
2. Lunedo uses the newest valid credential and falls back to older ones when the provider refuses it. For SAML, Lunedo's metadata lists old and new certificate while both exist.
3. Once the provider uses the new credential, remove the old one with **Remove credential**.

**Use this one** keeps an older valid credential of the same kind in use until it expires, is removed or you choose **Use the newest again**. The last credential of a kind cannot be removed; add a new one first.

The instance owner and the holders of the instance area "Sign-in and security" get a notification 30 and 7 days before the last valid credential expires, and the provider list shows a warning. Without a valid credential, sign-in through the provider stops.

For LDAP, change the password of the service account in the directory first, then enter it with **Enter new password**, and remove the old one afterwards.

## Testing a provider

The assistant's **Test** step and the **Overview** of the provider test the provider with a real sign-in (OIDC and SAML) or a directory lookup (LDAP). Use an account of the provider that is allowed to use Lunedo. Nothing is saved and no account is created.

A successful test shows what Lunedo received: the identifier, e-mail address, sign-in name, display name, the groups, and the claims or attributes as sent. Tokens, raw assertions, hashes, nonces and secrets are never shown. When the e-mail address is missing or not in the provider's domains, the test says so: Lunedo can then neither create nor link an account.

A failed test returns to the page it started from with the provider's message and one of these reasons:

| Reason | What it means | What to do |
|---|---|---|
| Provider refused | The provider refused the sign-in. | Read the provider's message, correct the setting at the provider or in Lunedo, test again. |
| User not assigned | The test account is not assigned to the application (Entra ID). | Assign the person or one of their groups to the enterprise application, or turn off the assignment requirement. |
| Consent required | The application has no consent for the requested permissions (Entra ID). | Grant admin consent for the app registration. |
| Unknown application | The provider does not know the client ID (Entra ID). | Copy the application (client) ID of the app registration into Lunedo. |
| Invalid client | The provider accepted none of Lunedo's credentials. | Add the current client secret, or upload Lunedo's certificate at the provider. |
| Other tenant | The test account belongs to another Entra ID tenant than the one set in Lunedo. | Check the tenant ID, or test with an account of the configured tenant. |
| Domain not allowed | The account is not in one of the provider's domains. | Add the domain to the provider, or test with an account of a configured domain. |
| Browser changed | The sign-in came back in another browser, or the browser lost Lunedo's cookie. | Start the test again and finish it at the provider without switching browsers. |
| Invalid response | Lunedo could not accept the provider's answer. | Check the provider's message and the settings at the provider, such as the redirect URI and the signing certificate. |

For the checks of the directory test, see [LDAP and Active Directory](identity-providers/ldap.md#testing-the-directory).

## Identities

An account can have several linked identities, one per provider and identifier. The identifier never changes at the provider; which value it is depends on the method and is named on each method page. E-mail address, sign-in name and display name are updated at every sign-in.

Lunedo never recognizes an account by its e-mail address alone. An address from a provider counts as verified only when its domain is one of the provider's domains.

People who manage accounts see the **Linked sign-ins** of an account in **Settings › Instance › People and sign-in › Accounts**, on the tab **Sign-in and security** of the account. There they can **Link identity** by choosing a provider and entering the identifier at the provider, which a test sign-in shows, and **Unlink** an identity. Linking makes the account managed by that provider, except for the instance owner. Unlinking ends the sessions that came from that identity; what happens when it was the last link is described in [Making an account local](#making-an-account-local).

People see their own linked sign-ins under **Settings › My account › Profile**. They can unlink one while another way to sign in remains, but not the identity of the provider that manages their account (`managedIdentity`).

## Managed accounts

An account is managed by a provider when:

- an identity of the provider is linked to it: the provider or [SCIM](scim.md) created the account, the account was linked at a sign-in, or an administrator linked it; or
- the domain of its e-mail address is one of the provider's domains.

A linked identity decides before a domain. When identities of several providers are linked, the provider linked most recently manages the account. Only providers whose setup is finished count. Every other account is local, including guests whose domain belongs to no provider. The instance owner is never managed, see [Emergency sign-in](#emergency-sign-in).

The provider list shows in the column **Accounts** how many accounts each provider manages, and the provider's **Overview** shows the same number as **Managed accounts**. On the account page under **Settings › Instance › People and sign-in › Accounts**, **Security at a glance** shows **Signs in through** with the provider, or **Lunedo** for a local account; the account list has the column **Sign-in**. In an organization, people who manage members see the same column in **Settings › Organization › People and access › Members** and **Signs in through** on the member's page.

Lunedo stores which provider manages each account and since when, and updates it when an identity is linked or unlinked, when a provider is set up, changed or removed, when its domains change, when an account is created or changes its e-mail address, and when the instance ownership moves to another account. Each change is recorded in the audit log as `account.managed` or `account.unmanaged`, with the provider and whether the identity or the domain decided.

What a managed account can do depends on the method:

| | OIDC or SAML | LDAP |
|---|---|---|
| Sign-in | Only through the provider | With the directory password on the Lunedo sign-in page |
| Lunedo password | Not used: sign-in, change and reset are refused | Not used: sign-in, change and reset are refused |
| Passkey sign-in without password | Refused | Refused |
| Second factor in Lunedo | None: authenticator apps, passkeys and recovery codes cannot be added, **Require two-factor authentication** does not apply, and **Reset second factor** is refused. The provider handles the second factor. | As for local accounts: authenticator app or passkey, recovery codes, **Require two-factor authentication** applies, and administrators can reset it |
| E-mail address | Comes from the provider; changing it in Lunedo is refused | Comes from the directory; changing it in Lunedo is refused |

Refused requests are answered with `403` and the problem code `managedAccount`, which names the provider. A password sign-in answers `managedAccount` only after a correct password.

When a domain is added to a provider, the accounts with that domain are managed at once: their password and passkey sign-in is refused from then on, but their stored credentials and sessions stay until the first sign-in through the provider. When the domain is removed again before that sign-in, the accounts are local again with their earlier password.

### Taking over an existing account

At the first sign-in through a provider whose verified e-mail address belongs to an existing account, Lunedo links the identity to the account without asking, because the provider's domain makes the address verified (see [First sign-in](#first-sign-in)). When the account was not managed through a linked identity before:

- For OIDC and SAML, Lunedo deletes its password, passkeys, authenticator app and recovery codes.
- For LDAP, Lunedo deletes its Lunedo password; authenticator app, passkeys and recovery codes stay as second factor.
- All other sessions of the account end, and open password reset and e-mail change links stop working.
- Content, groups, roles and memberships stay.
- The person receives an e-mail that the account now signs in through the provider.
- The audit log records `identity.linked`, `account.managed` and `account.localCredentialsRemoved`, with what was removed.

The instance owner is never taken over this way; the owner confirms a link as described in [First sign-in](#first-sign-in) and stays local. When the account is already linked to another identity of the same provider, the sign-in is refused with the reason "Your sign-in could not be linked to your account".

### Deactivated providers

A deactivated provider keeps managing its accounts. They cannot sign in until the provider is activated again or the accounts move to another provider. Lunedo does not fall back to a password, and a password reset sends no link.

### Moving to another provider

Accounts move with the existing linking: at the first sign-in through the new provider with a verified matching address, or with **Link identity** by an administrator. The provider linked last manages the account. Unlink the identity of the old provider afterwards. Because a domain belongs to only one provider, move the domain to the new provider before people sign in there with addresses in it.

### Making an account local

An administrator makes an account local by unlinking its last identity with **Unlink**; the confirmation explains the e-mail when it is the account's last linked provider. When no provider has the domain of its address, the account becomes local and the person receives an e-mail with a link to set a password, valid for 30 minutes; afterwards **Forgot password?** on the sign-in page works. When a provider still has the domain, the account stays managed through the domain, and no e-mail is sent.

Making an account local is refused for accounts that are not active (`accountNotActive`); reactivate the account first. Unlinking is recorded as `identity.unlinked` and `account.unmanaged`.

## First sign-in

When nobody is linked to the identity yet, Lunedo decides in this order:

1. The verified e-mail address belongs to an existing account: Lunedo links the identity to the account and [takes it over](#taking-over-an-existing-account). Only the instance owner confirms once that the account is theirs, with a way to sign in the account already has:
   - its Lunedo password, followed by its second factor;
   - one of its passkeys;
   - a fresh sign-in through a provider already linked to it, or the password of a linked directory.

   The confirmation must happen within 15 minutes after the sign-in. "This is not my account" ends the sign-in with a reference.
2. Otherwise, when **Create accounts at first sign-in** is on and the address is in one of the provider's domains, Lunedo creates a standard account without a password. When a placeholder account has the address, the placeholder becomes the person's account instead. With **Require group membership**, the person must be in one of the **Required groups**.
3. Otherwise the sign-in is refused.

The home organization of a new account comes from the first mapping rule, in rule order, that names one for a group of the person; otherwise from the organization that owns the e-mail domain; otherwise it is the first organization the person becomes a member of, through a mapping rule or in another way. When the account ends up in no organization, the person sees that no organization is assigned yet, and the instance administrators get a notification. The account list in **Settings › Instance › People and sign-in › Accounts** has the filter "Without organization" for such accounts. See [Accounts](accounts.md) for assigning an organization.

Every refusal gets a reference such as `7KQ2-M9XA`, shown on the refusal page together with the reason and what the person can do. Refusals are kept for 90 days. To look one up, filter the instance [audit log](audit-log.md) for refused sign-ins; the entry carries the reference and the reason.

*name* is the name of the organization when the instance has exactly one, otherwise the name of the instance.

| Reason on the refusal page | Cause |
|---|---|
| No account exists for you in *name* | Creating accounts at first sign-in is off for the provider, and nobody invited the person. |
| Your address is not accepted by this provider | The provider sent no address, or one outside its domains. |
| You are not in a group that may use *name* | Required groups are set and the person is in none of them. |
| Your account is deactivated | The linked account is deactivated. |
| The accounts were not linked | The person chose "This is not my account". |
| Your account cannot be linked by you | The account with the address belongs to the instance owner and has no way to sign in the person could confirm with. |
| Your provider sent an answer Lunedo could not accept | The response failed a security check, for example because it expired or was meant for another application. |
| Your provider did not confirm a second factor | The provider is set to **Require proof from the provider**, and its answer carried none of the **Accepted proof values**. |
| Your sign-in could not be linked to your account | The account with the address is already linked to another identity of this provider. |

## Sessions and sign-out

A session created through a provider remembers the identity and, for OIDC, the provider's session ID.

OIDC and SAML providers have the setting **Second factor after a sign-in through this provider** on the **Settings** tab. Accounts they manage have no second factor in Lunedo, so the provider is responsible for it:

| Option | Effect |
|---|---|
| Handled by the provider (default) | A sign-in through the provider is complete. Set up multi-factor authentication at the provider. |
| Require proof from the provider | The provider must report multi-factor authentication with one of the **Accepted proof values** (default `mfa`). Without it, the sign-in is refused with the reason "Your provider did not confirm a second factor", and a confirmation of identity through the provider fails. |

The instance owner is the exception: when the owner signs in through a linked provider, Lunedo asks for the owner's own second factor.

LDAP providers offer "Always ask for a Lunedo second factor" (default) and "No additional second factor". With the second, Lunedo still asks where the instance or an organization requires a second factor, because a directory password proves no second factor. When Lunedo asks, the person confirms with an authenticator code, a passkey or a recovery code; a person without a second factor first sets one up.

OIDC providers can end sessions with back-channel logout; see [OpenID Connect](identity-providers/openid-connect.md#back-channel-logout).

Accounts managed through OIDC or SAML confirm sensitive actions through their provider, which signs them in again. Accounts managed through LDAP confirm with their directory password, an authenticator code or a passkey.

## Deactivating and removing a provider

**Deactivate provider** stops a provider without losing anything:

- nobody can sign in through it, and the sign-in page no longer offers it;
- a running synchronization stops, and no new one starts;
- the sessions that came from it end. They do not come back when the provider is activated again.

Settings, credentials, identities, rules, groups and access stay. The accounts it manages stay managed and cannot sign in in another way, see [Deactivated providers](#deactivated-providers). **Activate** turns the provider on again.

**Remove provider** cannot be undone. It is refused while accounts are linked to the provider, with the problem code `providerHasAccounts` and the number of accounts. The dialog then says *name* **cannot be removed**, with the number of linked accounts, and offers **Deactivate provider** while the provider is active. Deactivate the provider instead, or [move the accounts](#moving-to-another-provider) or [make them local](#making-an-account-local) first.

Before the removal, Lunedo shows how many mapping rules are removed, how many memberships and roles granted by them are withdrawn, and how many synchronized groups become ordinary groups.

The removal deletes the provider's rules and withdraws what they granted. Synchronized groups keep their members and permissions and show that they were formerly synchronized from the provider. Accounts that were managed only through one of its domains become local again; they keep the password they had. Accounts and their content stay.

Deactivations and removals, like every change to providers, credentials and rules, are recorded in the [audit log](audit-log.md) and can be found there with the filter.

## Emergency sign-in

The instance owner's account is never managed by a provider, also when its domain belongs to one or an identity is linked to it. It keeps its password and always needs a second factor, so the owner can sign in when every provider fails. The sign-in page has the link **Emergency sign-in** at the bottom, which asks for the owner's e-mail address and password. The ownership can only be transferred to an account that is not managed (`ownerManaged`).

While at least one provider is active and set up, every sign-in of the owner with password or passkey counts as emergency sign-in. It is audited as `auth.emergencySignIn`, and the recipients get the notification `auth.emergencySignIn` at once. Without an active provider, signing in with a password is the normal way and is not reported.

The instance owner is always told. By default, all instance owners and administrators are told as well. In the section **Emergency sign-in of the owner** under **Settings › Instance › People and sign-in › Sign-in methods**, the instance owner can turn **Tell instance administrators** off, add up to 50 **Further people**, who are told in Lunedo and by e-mail, and up to 20 **Further e-mail addresses** outside Lunedo (`PUT /api/v1/instance/emergency-sign-in-recipients`). Only the instance owner can change the recipients, and every change is audited as `settings.changed`.

## Security

- Providers must be reached through HTTPS. LDAP directories must be reached through LDAPS or StartTLS. Microsoft Graph and the Google Directory API are only called on their own hosts.
- The environment variable `LUNEDO_INSECURE_IDENTITY_PROVIDERS=true` allows plain HTTP, unencrypted LDAP and other hosts. It is for development and tests only; while it is set, instance administrators see a warning banner. See [Configuration](configuration.md).
- Sign-in flows are bound to the browser that started them and are valid for 10 minutes. A sign-in that started in one browser cannot be completed in another.
- Each SAML assertion and each logout token is accepted once.
- Sign-in through a provider never grants access by itself: access comes from invitations, memberships granted by hand and [mapping rules](identity-provider-groups.md#mapping-rules).
