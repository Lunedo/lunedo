# Test identity providers

Keycloak and Authentik run as OpenID Connect providers with test users and groups, Keycloak also as SAML provider, and OpenLDAP as directory. They belong to the Compose profile `idp` of `docker/compose.dev.yml` and start only on request, because Authentik needs its own database and both take a minute to start:

```sh
pnpm dev:idp
```

`pnpm dev:down` stops them together with the rest of the environment. The values on this page are the fixed test data of `docker/idp`; they are for development and tests only.

## OpenID Connect providers

| Provider | Issuer | Client ID | Client secret | Administration |
|---|---|---|---|---|
| Keycloak | `http://keycloak.localhost:8080/realms/lunedo` | `lunedo` | `lunedo-keycloak-secret` | `http://keycloak.localhost:8080/admin`, user `admin`, password `admin` |
| Authentik | `http://authentik.localhost:9000/application/o/lunedo/` | `lunedo` | `lunedo-authentik-secret` | `http://authentik.localhost:9000`, user `akadmin`, password `admin`, API token `lunedo-authentik-api-token` |

Browsers and the `app` container reach both providers under the same `*.localhost` address, so the issuer in tokens matches the issuer Lunedo discovers. Browsers resolve `*.localhost` to the local machine; the `app` container maps the two names to the host. Keycloak accepts redirect URIs on `localhost` and `127.0.0.1` with the ports 3000, 5173 and the port of the end-to-end tests (`LUNEDO_E2E_PORT`, default 4310); Authentik accepts any port on these two hosts. The providers are set up from `docker/idp/keycloak/lunedo-realm.json` and the Authentik blueprint `docker/idp/authentik/lunedo.yaml` at start.

Test users, all with the password `lunedo-test-password`:

| User | E-mail | Groups |
|---|---|---|
| `alice` | `alice@example.org` | engineering, admins |
| `bob` | `bob@example.org` | engineering |
| `carol` | `carol@example.org` | none |
| `dave` | `dave@example.org` | engineering; tests disable this account |
| `erin` | `erin@example.net` | none; e-mail outside the configured domain `example.org` |

Both providers send the stable group IDs in the `groups` claim and the group names in `group_names`. Keycloak sends them without an extra scope, Authentik with the scope `groups`. In Keycloak the IDs are fixed in the realm (`engineering` is `6f1c2b8e-3a4d-4c5e-9f60-7a8b9c0d1e2f`, `admins` is `0b9a8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d`); in Authentik they are created at the first start and can be looked up by the group attribute `lunedo_test_group`.

Back-channel logout goes to the URL in `LUNEDO_KEYCLOAK_BACKCHANNEL_LOGOUT_URL` and `LUNEDO_AUTHENTIK_BACKCHANNEL_LOGOUT_URL` when the providers start; tests set it through the administration interfaces. The providers reach Lunedo on the host as `host.docker.internal`.

## SAML

Keycloak also serves as SAML identity provider. Its metadata is at `http://keycloak.localhost:8080/realms/lunedo/protocol/saml/descriptor`. The SAML client is not part of the realm, because its entity ID contains the ID of the Lunedo provider: the end-to-end tests create the provider, load Lunedo's service provider metadata from `/api/v1/auth/providers/{providerId}/saml/metadata` and register it through the Keycloak administration API.

To try SAML by hand:

1. Create a SAML provider in Lunedo and download its service provider metadata.
2. In the Keycloak administration, import it under **Clients › Import client**.
3. Turn on **Force POST binding**.
4. Add the mappers `email` (user property) and `groups` (group list, without full path).

## OpenLDAP

OpenLDAP runs in the same profile on `ldap://localhost:3389` (`ldap://openldap:389` from the `app` container), built from `docker/idp/openldap` with the base `dc=example,dc=org`. Lunedo connects with the service account `cn=lunedo,ou=service,dc=example,dc=org` and the password `lunedo-ldap-service-password`; the administrator is `cn=admin,dc=example,dc=org` with the password `admin`. The plain connection works only because the development environment sets `LUNEDO_INSECURE_IDENTITY_PROVIDERS`. People live under `ou=people`, groups under `ou=groups`, and the user filter is the default `(objectClass=inetOrgPerson)`:

| User | E-mail | Groups |
|---|---|---|
| `lena` | `lena@directory.example.org` | staff, platform, and engineering through platform |
| `max` | `max@directory.example.org` | staff, platform, and engineering through platform |
| `nora` | `nora@directory.example.org` | staff; tests disable this account |
| `otto` | `otto@directory.example.org` | none; disabled through `employeeType: disabled` |

All of them have the password `lunedo-test-password`.

## End-to-end tests

`apps/web/e2e/support/idp.ts` drives Keycloak and Authentik in end-to-end tests: it signs in through their login forms, disables and enables users, creates and deletes users, changes group memberships and group names, ends sessions and sets the back-channel logout URL. Every test creates its own users with unique names and deletes them afterwards, so a test can run alone and be retried.

The tests in `apps/web/e2e/idp` run in the Playwright project `idp`, which exists only when `LUNEDO_E2E_IDP=1` is set:

```sh
LUNEDO_E2E_IDP=1 pnpm --filter @lunedo/web exec playwright test --project=idp
```

`LUNEDO_E2E_KEYCLOAK_URL`, `LUNEDO_E2E_AUTHENTIK_URL` and `LUNEDO_E2E_LDAP_URL` point the tests at other ports. Before the tests start, CI waits until Authentik shows its sign-in form in a browser (`apps/web/e2e/support/wait-for-authentik.ts`).

## Fakes for unit and integration tests

`@lunedo/server/testing` exports small local fakes from `packages/server/src/testing`:

| Fake | Replaces |
|---|---|
| `startFakeGraph()` | Microsoft Graph: application tokens through client credentials, users and groups with `@odata.nextLink` paging, a person with 250 groups for the Entra ID group overage, nested groups, a disabled account, and sent mail. |
| `startFakeGoogleDirectory()` | Google Directory API: application tokens through a service account assertion, `nextPageToken` paging, a suspended account. |
| `startFakeOidcProvider()` | An OpenID Connect provider whose tokens a test can change. |
| `createFakeSamlIdp()` | A SAML identity provider that signs and encrypts responses. |
| `FakeLdapDirectory` | A directory that evaluates real LDAP filters, for the Active Directory specifics: the nested group matching rule, `userAccountControl`, `accountExpires` and the sub-codes of failed binds. |

The fakes start on a free port inside a test. Tests change their data directly or through `/_fake/...` requests. To run the Graph and Google fakes as a process, on ports 4320 and 4321 (`LUNEDO_FAKE_GRAPH_PORT`, `LUNEDO_FAKE_GOOGLE_PORT`):

```sh
node --import ./packages/server/src/testing/ts-resolve.mjs packages/server/src/testing/fakes/serve.ts
```
