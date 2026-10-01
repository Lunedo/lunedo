# Public API

Scripts and integrations use the same HTTP API as the web client. Every instance serves a reference of its own API at `/api/docs`.

## Reference

`/api/docs` shows the API reference with [Scalar](https://github.com/scalar/scalar). The page, the renderer and the OpenAPI description (`/api/docs/openapi.json`) come from the instance itself; nothing is loaded from other hosts, telemetry is off and the page sends a strict content security policy. By default only signed-in users and requests with an API token can open it. The instance setting `apiTokens.publicDocumentation` makes it public.

The description is generated from the route declarations and Zod schemas in `apps/api`. Internal routes, which serve only the web client, follow the same conventions but are left out of the reference. The generated file `apps/api/openapi.json` is committed and contains every route, because the web client's types are generated from it; internal routes carry `x-pagehall-internal: true` and `x-stability-level: alpha`, so changing them is not a breaking change:

```sh
pnpm --filter @pagehall/api build
pnpm --filter @pagehall/api openapi
```

Tests fail when the committed file differs from the generated one, when a public route lacks a summary, description, tag, documented error or example, when a field lacks a description, or when an example does not match its schema. Integration tests check every response against the description. A pull request that makes a breaking change to the description fails the `API compatibility` workflow unless it has the label `breaking-api-change`; the workflow runs [oasdiff](https://github.com/oasdiff/oasdiff) against the base branch.

## Conventions

- Routes are versioned under `/api/v1`.
- Each route declares its permission; the description names it in `x-pagehall-permission` and in the text.
- Errors are Problem Details (RFC 9457) with the media type `application/problem+json`. `type` is stable, for example `urn:pagehall:problem:forbidden`, and `code` repeats its last part.
- Lists use cursor pagination: `?cursor=&limit=` (1 to 200, default 50) and the response `{ "items": [...], "nextCursor": "..." }`; `nextCursor` is `null` on the last page. Lists that grow with an organization or the instance page in the database on an index, so a page costs the same at any position; only lists with a fixed upper bound, such as roles or one's own sessions, are paged in memory.
- Every response passes through its declared schema. Fields that are not declared are not sent.

## Service accounts

A service account belongs to an organization and acts only through API tokens: it has no password, no sessions and no interactive sign-in. Holders of the organization area "integrations and API" create, change and deactivate service accounts. A service account is a principal of its own: its permissions come only from its own roles and group memberships, which can be much narrower than those of any person. Nobody can give it more than they hold themselves.

A service account has zero, one or several responsible people, by default its creator. They receive reminders before its tokens expire and notices about it; they grant no permissions and limit none. Holders of the integrations area change the list, and every change is audited. When the last responsible person leaves the organization or is deactivated, the organization's owners receive an e-mail once and the list of service accounts marks it as `unattended`; its permissions do not change. Unused tokens are the safeguard against forgotten service accounts: a token that is not used for `apiTokens.unusedNoticeDays` triggers a notice, and an expiry, when set or required, stops it.

Deactivating a service account revokes all its tokens at once.

## API tokens

There are personal tokens, which act as their owner, and tokens of service accounts.

- A token is `ph_` followed by 43 base62 characters (256 bits of randomness) and a six-character checksum, so secret scanners recognize it and clients can reject typos without a request. Only a hash is stored; the token is shown once, when it is created.
- Scopes are permission areas with `view` or `manage`, for the instance and for organizations, optionally limited to one organization. A token limited to one organization has no instance scopes and grants nothing outside that organization. At every request the token can do only what both its scopes and the current permissions of its owner allow. A token for a service account is created only when what it allows, its scopes intersected with the service account's roles, is covered by the creator's own permanent permissions.
- Tokens have no expiry unless one is set when creating them. The maximum lifetime of API tokens, `apiTokens.maxLifetimeDays` in days, is empty by default. When the instance or an organization sets it, every new token needs an expiry within it, and a token created without one gets the maximum; lower levels may only shorten it, and cannot remove it. A personal token follows the strictest value of every organization it reaches: its own organization if it is limited to one, otherwise every organization its owner belongs to. `GET /api/v1/account/tokens/lifetime` and `GET /api/v1/service-accounts/{id}/tokens/lifetime` return the maximum that applies to a new token, or null. `expiryRequired` and `expiryTooLate` problems carry `maxLifetimeDays`.
- The owner, or every responsible person of a service account, gets an e-mail `apiTokens.expiryReminderDays` (default 7) before a token expires.
- A token that has not been used for `apiTokens.unusedNoticeDays` (instance, default 90) triggers the notification `apiToken.unused` to its owner, for a service account to its responsible people and, without any, to the organization's owners. The token keeps working. The notice comes once per idle period: only a new use followed by another idle period triggers it again.
- Personal tokens stop working when their account is deactivated; deactivation revokes them.
- Tokens are accepted only in `Authorization: Bearer`. A request that carries both a session cookie and a token is rejected with `ambiguousCredentials`. Requests with a token and no session cookies are exempt from the cross-site request check.
- Each token may send `apiTokens.requestsPerMinute` requests per minute (default 600); above that the API answers `429` with `Retry-After`. The limit is kept in the database, so it holds across nodes.
- Last use, time and client address, is recorded at most once per minute.
- Creating, changing, revoking and expiring tokens and rejected tokens are recorded in the audit log, rejected tokens at most ten times per minute per client address. Successful use is not.

Managing tokens needs a signed-in session; a token cannot create, list or revoke tokens. Routes that require recent authentication refuse tokens as well.

| Endpoint | Access |
|---|---|
| `GET, POST /api/v1/account/tokens`, `PATCH, DELETE /api/v1/account/tokens/{id}` | session, own tokens; creating needs recent authentication |
| `GET, POST /api/v1/organizations/{id}/service-accounts` | `organization.integrations.view`, `organization.integrations.manage` |
| `GET, PATCH /api/v1/service-accounts/{id}`, `POST .../deactivate` | `serviceAccount.view`, `serviceAccount.manage` |
| `GET, POST /api/v1/service-accounts/{id}/tokens`, `DELETE .../tokens/{tokenId}` | `serviceAccount.view`, `serviceAccount.manage`, session only; creating needs recent authentication |
| `GET, DELETE /api/v1/organizations/{id}/api-tokens` | `organization.integrations.view`, `organization.integrations.manage`, session only |

The organization endpoints list and revoke the tokens of its service accounts, the tokens limited to it and the personal tokens of accounts whose home organization it is.
