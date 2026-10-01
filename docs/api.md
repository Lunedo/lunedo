# Public API

Scripts and integrations use the same HTTP API as the web client. Every instance serves a reference of its own API at `/api/docs`.

## Reference

`/api/docs` shows the API reference with [Scalar](https://github.com/scalar/scalar). The page, the renderer and the OpenAPI description (`/api/docs/openapi.json`) come from the instance itself; nothing is loaded from other hosts, telemetry is off and the page sends a strict content security policy. By default only signed-in users and requests with an API token can open it. The instance setting `apiTokens.publicDocumentation` makes it public.

The description is generated from the route declarations and Zod schemas in `apps/api`. Internal routes, which serve only the web client, follow the same conventions but are left out. The generated file `apps/api/openapi.json` is committed:

```sh
pnpm --filter @pagehall/api build
pnpm --filter @pagehall/api openapi
```

Tests fail when the committed file differs from the generated one, when a public route lacks a summary, description, tag, documented error or example, when a field lacks a description, or when an example does not match its schema. Integration tests check every response against the description. A pull request that makes a breaking change to the description fails the `API compatibility` workflow unless it has the label `breaking-api-change`; the workflow runs [oasdiff](https://github.com/oasdiff/oasdiff) against the base branch.

## Conventions

- Routes are versioned under `/api/v1`.
- Each route declares its permission; the description names it in `x-pagehall-permission` and in the text.
- Errors are Problem Details (RFC 9457) with the media type `application/problem+json`. `type` is stable, for example `urn:pagehall:problem:forbidden`, and `code` repeats its last part.
- Lists use cursor pagination: `?cursor=&limit=` (1 to 200, default 50) and the response `{ "items": [...], "nextCursor": "..." }`; `nextCursor` is `null` on the last page.
- Every response passes through its declared schema. Fields that are not declared are not sent.

## Service accounts

A service account belongs to an organization and acts only through API tokens: it has no password, no sessions and no interactive sign-in. Holders of the organization area "integrations and API" create, change and deactivate service accounts. A service account is a member of its organization and holds roles and group memberships like other accounts; nobody can give it more than they hold themselves.

The person who creates a service account becomes its responsible person. While that person is an active member, the service account never has a permission that the responsible person lacks: when they lose a role, the service account loses it at the same moment. When the responsible person leaves or is deactivated, the field is cleared and the service account keeps working with its own roles. Administrators can name another responsible member.

Deactivating a service account revokes all its tokens at once.

## API tokens

There are personal tokens, which act as their owner, and tokens of service accounts.

- A token is `ph_` followed by 43 base62 characters (256 bits of randomness) and a six-character checksum, so secret scanners recognize it and clients can reject typos without a request. Only a hash is stored; the token is shown once, when it is created.
- Scopes are permission areas with `view` or `manage`, for the instance and for organizations, optionally limited to one organization. At every request the token can do only what both its scopes and the current permissions of its owner allow.
- Tokens expire, by default after 90 days. `apiTokens.maxLifetimeDays` (default 365) caps the lifetime; organizations may only lower it. Tokens without expiry need `apiTokens.withoutExpiry`, which is off by default and can only be turned off at lower levels. The owner, or the responsible person of a service account, gets an e-mail `apiTokens.expiryReminderDays` (default 7) before a token expires.
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
