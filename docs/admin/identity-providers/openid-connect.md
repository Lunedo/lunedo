# OpenID Connect

Checked against Keycloak and Authentik documentation, October 2026.

Use **Other OIDC provider** for identity providers that speak OpenID Connect, such as Keycloak, Authentik, Okta or Zitadel. People sign in at the provider; profile and groups update at every sign-in. Generic OIDC providers have no directory Lunedo could synchronize with in the background; with [SCIM](scim.md), the provider can send changes at once.

For Microsoft Entra ID and Google Workspace, use their presets instead: [Microsoft Entra ID](entra-id.md), [Google Workspace](google-workspace.md). What all providers share, such as domains, credentials, testing and the first sign-in, is described in [Identity providers](../identity-providers.md).

## Setting up the provider

1. In **Settings › Instance › People and sign-in › Sign-in methods**, choose **Add provider** and **Other OIDC provider**. The **Connection** step shows the redirect URI, for example `https://wiki.example.com/api/v1/auth/providers/{provider ID}/callback`.
2. At the provider, create a confidential OIDC client with the authorization code flow and enter the redirect URI.
3. In Lunedo, enter:
   - **Issuer URL**: the address of the provider. Lunedo reads its configuration from `/.well-known/openid-configuration` below it.
   - **Client ID** of the client.
   - The credential: the client secret, or choose a certificate and register Lunedo's certificate at the provider for `private_key_jwt`.
   - **Token signature**: the algorithm the provider signs ID tokens with.
4. Choose **Save and continue**. Lunedo reads the discovery document. When it fails, the message names the address and what to check; the issuer in the document must match the entered issuer exactly, including a trailing slash.
5. Choose the claims under **User attributes** and the settings on **Accounts**.
6. Test the sign-in and choose **Finish**.

The provider must be reached through HTTPS.

## Sign-in flow

Lunedo uses the authorization code flow with PKCE (S256), `state` and `nonce`, and asks for the scopes `openid`, `profile` and `email`. For **Other OIDC provider**, the list of scopes (at most 20) can be changed through the API, not in the settings page. A client secret is sent in the token request body (`client_secret_post`).

ID tokens are checked for issuer, audience, expiry, nonce and signature. **Token signature** is the only algorithm Lunedo accepts: one of RS256 (default), RS384, RS512, PS256, PS384, PS512, ES256, ES384 or ES512. Unsigned tokens and tokens signed with another algorithm are refused.

## Claims

The identifier is the `sub` claim. The other claims are configurable:

| Setting | Default | Notes |
|---|---|---|
| Claim for the e-mail address | `email` | Used for notifications, invitations and the home organization by domain. |
| Claim for the sign-in name | `preferred_username` | Shown next to the e-mail address. |
| Claim for the display name | `name` | |
| Claim for groups | none | Leave empty if the provider does not send groups. |
| Claim for group names | none | Optional. Names in the same order as the groups; groups are matched by the value in the groups claim, names are only shown. |

The claims must be in the ID token. A test sign-in shows every claim the provider sends.

### Groups

Lunedo matches mapping rules by the values in the groups claim. Use a value that never changes, such as a group ID, if the provider can send one, and send the names in the second claim. When the groups claim carries names, renaming a group at the provider breaks the rules for it until they are changed in Lunedo.

A sign-in whose ID token has no groups claim counts as a person without groups, because providers such as Keycloak leave the claim out for people in no group. Only distributed claims (`_claim_names`) leave the groups unknown. When the provider sent the claim before and stops, instance administrators see a banner with the provider and the date, until a sign-in carries the claim again or the groups setting changes. See [Identity provider groups](identity-provider-groups.md#groups).

For generic providers, the rule dialog suggests the groups Lunedo has seen at sign-ins; to use another group, type its value exactly as the provider sends it.

## Back-channel logout

When the provider supports OpenID Connect back-channel logout, enter this address as the back-channel logout URL of the client:

```
https://wiki.example.com/api/v1/auth/providers/{provider ID}/backchannel-logout
```

Lunedo accepts a logout token signed with the configured algorithm, issued for its client ID and at most 10 minutes old. It refuses tokens that were used before and tokens with a nonce. The token ends the sessions of the provider session it names, or, when it names the person, all sessions that came from this person's identity at the provider.

## Second factor

With **Require proof from the provider**, Lunedo checks the `amr` claim of the ID token for one of the **Accepted proof values**, `mfa` by default, and refuses the sign-in without one. Check with a test sign-in which values the provider sends.

## Keycloak

- Issuer URL: `https://sso.example.com/realms/{realm}`.
- Create an OpenID Connect client with client authentication turned on, and enter the redirect URI as valid redirect URI.
- To send groups, add a mapper of the type **Group Membership** to the client, with the token claim name `groups` and **Add to ID token** on, and enter `groups` as **Claim for groups**. With **Full group path** on, Keycloak sends paths such as `/staff/editors`; turn it off to send plain group names. Either way, renaming a group in Keycloak breaks its rules.
- When the ID token carries no `amr` claim, add a mapper of the type **Authentication Method Reference (AMR)** to the client.

## Authentik

- Issuer URL: `https://auth.example.com/application/o/{application slug}/`, with the trailing slash. This is the issuer when the provider keeps its default issuer mode, one issuer per provider; otherwise enter the `issuer` value from the provider's discovery document.
- Create an OAuth2/OpenID provider with the client type **Confidential** and add the redirect URI with the matching mode **Strict**.
- Keep **Include claims in id_token** on in the advanced protocol settings, so that the claims are in the ID token.
- Choose a signing key for the provider, so that ID tokens are signed with RS256 or another algorithm from the list above.
- The default `profile` scope sends the names of the person's groups in the claim `groups`. Enter `groups` as **Claim for groups**. Renaming a group in Authentik breaks its rules.
