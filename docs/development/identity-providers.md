# Identity providers

This page describes how sign-in through identity providers is built. The administrator's view is in [docs/admin/identity-providers.md](../admin/identity-providers.md); the test providers used in CI are in [Test identity providers](test-identity-providers.md).

## Framework

The code lives in `packages/server/src/identity/`. Provider types and presets, their configuration schemas and limits are defined in `packages/shared/src/identity-providers.ts`:

| Type | Presets | Adapter |
|---|---|---|
| `oidc` | `entraId`, `google`, `generic` | `OidcAdapter` in `oidc.ts`, built on [openid-client](https://github.com/panva/openid-client) |
| `saml` | `entraId`, `adfs`, `generic` | `SamlAdapter` in `saml.ts`, built on `@node-saml/node-saml` with own checks of the XML |
| `ldap` | `activeDirectory`, `generic` | `LdapAdapter` in `ldap.ts`, built on `ldapts` |

The adapters are created once in `packages/server/src/services.ts` and passed to the services that need them. `ProviderSignInService` (`sign-in.ts`), `MappingRuleService` (`mapping.ts`) and the synchronization service (`sync.ts`) keep them in a map by type and look the adapter up for each provider. A sign-in with a type that has no adapter fails with an error instead of falling back to another adapter.

The sign-in flow, linking, accounts at first sign-in, managed accounts (`managed.ts`, see [Authentication](authentication.md#managed-accounts)), the refusal page, mapping rules, synchronization runs and SCIM do not depend on the protocol. A new protocol only adds an adapter, a configuration schema and its presets.

## Adapter interface

Every adapter implements `IdentityProviderAdapter` in `adapter.ts`. Only the first two methods are required; the others are optional and absent where a type cannot do it.

| Method | Purpose | Implemented by |
|---|---|---|
| `authorizationUrl` | Builds the address the browser is sent to. Receives redirect URI, state, nonce, PKCE challenge and whether to force a fresh sign-in. | OIDC, SAML; LDAP throws |
| `completeSignIn` | Validates the callback or SAML response and returns the profile, authentication methods, `auth_time`, provider session ID and the received claims. | OIDC, SAML; LDAP throws |
| `verifyLogout` | Validates a back-channel logout token. | OIDC |
| `authenticate` | Signs in with sign-in name and password on the Lunedo page. | LDAP |
| `verifyPassword` | Checks the password of a known identity, for re-authentication and link confirmation. | LDAP |
| `testDirectory` | Runs the directory test step by step. | LDAP |
| `readProfile` | Reads the profile of one identity from the directory. | OIDC (Entra ID, Google with user access), SAML (Entra ID with Graph), LDAP |
| `readGroups` | Reads the groups of one identity, used when the token or assertion carries none. | OIDC (Entra ID, Google with group synchronization), SAML (Entra ID with Graph), LDAP |
| `synchronizeAccounts` | Yields the state, profile and groups of the given identities for a synchronization run. | Same as `readProfile` |
| `hasDirectory` | Whether the provider has a directory Lunedo can search and synchronize. Decides group search, member counts and background synchronization. | OIDC, SAML, LDAP |
| `readGroupNames` | Resolves names for group IDs that came without names. | OIDC and SAML (Entra ID) |
| `readGroup` | Resolves one group ID in the directory; used to check the group of a new or changed mapping rule. | OIDC, SAML, LDAP |
| `searchGroups` | Searches groups by name for the rule dialog, up to 25. | OIDC, SAML, LDAP |
| `countMembers` | Counts the members of a group at the provider for the rule preview. Returns `null` where unknown. | OIDC (Entra ID, Google); LDAP returns `null` |

`SynchronizedAccount.state` is `enabled`, `disabled`, `deleted` or `unknown`. `unknown` means the adapter cannot tell, for example Google without user access; the sync run then updates groups only.

The capabilities a provider reports (`groups`, `directorySync`, `disabledAccounts`, `groupsByName`) are computed per preset by `oidcCapabilities`, `samlCapabilities` and `ldapCapabilities` and drive what the web client offers.

Errors:

- `ProviderResponseError`: the provider's answer was not acceptable. Messages pass through `plainText`, which removes control characters.
- `ProviderPolicyError` with `domainNotAllowed` or `otherTenant`: the answer was valid but not allowed.
- `DirectorySignInError` and `DirectoryConnectionError` carry a reason that the API maps to a problem code or a directory test step.

## Identifiers

| Preset | Subject stored in `identities.subject` |
|---|---|
| Entra ID (OIDC and SAML) | `{tenant ID}:{object ID}`, lowercase |
| Google | `sub` |
| Generic OIDC | `sub` |
| ADFS, generic SAML with identifier attribute | the attribute; a Base64 GUID is converted to the GUID form, otherwise lowercased |
| Generic SAML without identifier attribute | the persistent NameID |
| Active Directory | `objectGUID` in GUID form |
| Generic LDAP | `entryUUID`, lowercase |

## State, nonce and verifier

`ProviderSignInService.start` creates a row in `provider_flows` for every redirect-based flow: sign-in, re-authentication, test and link confirmation.

- `state` and a separate browser token are random values. Only their SHA-256 hashes are stored (`state_hash`, `browser_hash`). The browser token goes into the cookie `__Host-lunedo-provider` (10 minutes), so a flow started in one browser cannot be completed in another.
- `nonce` and the PKCE `code_verifier` are stored for OIDC flows only; SAML flows store the request ID instead.
- A flow is valid for 10 minutes. The callback consumes it with one `UPDATE … WHERE consumed_at IS NULL AND expires_at > now()`, so it is used once even with several nodes.
- A SAML response arrives by POST at the assertion consumer service. It is stored on the flow found by `RelayState` and then processed by the same callback as OIDC, after a redirect that carries the browser cookie. A response without a matching flow is accepted only with `idpInitiated`; Lunedo then creates a flow itself.
- The stored SAML response is cleared once it was checked. Test results are stored on the flow and can only be read by the session that started the test.

Consumed SAML assertion IDs are kept in `saml_assertions` and logout token IDs in `provider_logout_tokens` until they expire, so each is accepted once. Expired flows, assertion IDs and logout tokens, and refusals older than 90 days, are removed by the authentication cleanup job.

## First sign-in and second factor

`ProviderSignInService` finds the identity by provider and subject. Without one, an existing account whose address is verified for the provider is linked at once and taken over (`#adoptExisting`): the identity is stored, the managed state refreshed and `takeOverLocalCredentials` removes any local sign-in and queues the mail `accountManaged`. A sign-in through an identity that is already linked runs `takeOverLocalCredentials` too. An OpenID Connect address with `email_verified: false` never counts as verified. A second identity of the same provider for the account is refused with `linkAmbiguous`. The instance owner and accounts with a role above member (`confirmsLinks`) still go through the link confirmation (`identityLink` challenge, `/sign-in/link`); after a confirmed link, `takeOverLocalCredentials` runs as well, except for the owner, who is never managed.

The provider setting `secondFactor.mode` is `provider` or `providerProof` for OIDC and SAML, and `lunedo` or `provider` for LDAP. `providerProvedSecondFactor` decides for OIDC and SAML: with `providerProof`, a sign-in whose authentication methods contain none of `proofValues` is refused with `secondFactorMissing`, and re-authentication and link confirmation through the provider fail. After a provider sign-in, a Lunedo second factor is asked only where `SignInService.secondFactorRequirement` requires one, or always with the LDAP mode `lunedo`.

## Background jobs

| Job | Schedule | Purpose |
|---|---|---|
| `identity-providers.schedule-synchronization` | every 5 minutes | Enqueues due synchronization runs; with SCIM on, once a day as reconciliation |
| `identity-providers.synchronize` | on demand | One run for one provider; no retries |
| `identity-providers.remove-old-sync-runs` | daily at 03:23 | Applies `identityProviders.syncLogRetentionDays` |
| `identity-providers.send-credential-reminders` | hourly at :41 | Reminders 30 and 7 days before the last credential expires |
| `identity-providers.refresh-saml-metadata` | hourly at :17 | Reloads metadata from an address when it is older than 24 hours |

All run during maintenance mode.

## Outbound hosts

`LUNEDO_INSECURE_IDENTITY_PROVIDERS=false` (the default) enforces:

- HTTPS for issuers, metadata, SAML sign-in addresses and directory APIs;
- `ldaps://` or StartTLS for LDAP;
- the Entra ID authority must be one of `https://login.microsoftonline.com`, `https://login.microsoftonline.us` or `https://login.partner.microsoftonline.cn`, and the Graph endpoint must belong to the same cloud. The configuration fields `authority` and `graphUrl` are not shown in the web client;
- the Google issuer must be `https://accounts.google.com`, and the Directory API and token endpoint must be Google's.

## Routes

All identity routes are internal: they serve the web client and are hidden from `/api/docs`. Sign-in routes are listed in [Authentication](authentication.md#endpoints). Administration routes are under `/api/v1/instance/` and need `instance.signIn.view` or `instance.signIn.manage`; most changes also need a recent re-authentication.

| Route | Purpose |
|---|---|
| `GET, POST /instance/identity-provider-drafts`, `GET, PATCH, DELETE …/{draftId}` | Drafts of the setup assistant |
| `GET, POST /instance/identity-providers`, `GET, PATCH, DELETE …/{providerId}` | Providers; `POST` with `draftId` turns a draft into a provider with the same ID. Summaries carry `managedAccounts`, the number of accounts the provider manages. `DELETE` is refused with `providerHasAccounts` and the number of `accounts` while identities are linked |
| `POST …/{providerId}/complete-setup` | Finish the setup |
| `POST …/{providerId}/deactivate`, `…/activate`, `GET …/removal-preview` | Deactivate, activate, preview a removal |
| `POST …/{providerId}/credentials`, `PUT …/credentials/{id}/use`, `DELETE …/credentials/{id}`, `GET …/credentials/{id}/certificate` | Credentials |
| `PUT, DELETE …/{providerId}/logo` | Logo; `GET /api/v1/identity-providers/{providerId}/logo` is public |
| `POST …/{providerId}/test`, `GET …/test-results/{flowId}` | Test sign-in |
| `POST …/{providerId}/directory-test` | Directory test |
| `PUT …/{providerId}/saml-metadata`, `POST …/saml-metadata/refresh` | SAML metadata |
| `PUT, DELETE …/{providerId}/ca-certificate` | CA certificate of a directory |
| `PUT, DELETE …/{providerId}/directory-key` | Google service account key |
| `POST /instance/identity-provider-connection-checks` | Check connection settings before saving |
| `GET, POST …/{providerId}/mapping-rules`, `PUT, DELETE …/mapping-rules/{ruleId}`, `PUT …/mapping-rule-order` | Mapping rules |
| `GET …/{providerId}/groups`, `GET …/group-preview` | Group search and rule preview |
| `POST …/{providerId}/sync`, `GET …/sync-runs`, `GET …/sync-runs/{runId}`, `POST …/sync-runs/{runId}/cancel`, `POST …/sync-runs/{runId}/confirm` | Synchronization |
| `GET …/{providerId}/scim`, `POST …/scim/tokens`, `POST …/scim/tokens/{tokenId}/renew`, `DELETE …/scim/tokens/{tokenId}` | SCIM tokens |
| `GET, PUT /instance/emergency-sign-in-recipients` | Recipients of the emergency sign-in notification |
| `GET /instance/sign-in-security` | Warnings about the sign-in security of the instance |
| `GET /instance/sign-in-refusals/{reference}` | Look up a refused sign-in |

SCIM is served at `/scim/v2/{providerId}` (`ServiceProviderConfig`, `ResourceTypes`, `Schemas`, `Users`, `Groups`) with the SCIM token as bearer token.
