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

A service account has zero, one or several responsible people, by default its creator. They receive reminders before its tokens expire and notices about it, and without any the organization's owners receive them; they grant no permissions and limit none. Holders of the integrations area change the list, and every change is audited. When the last responsible person leaves the organization or is deactivated, the organization's owners receive an e-mail once and the list of service accounts marks it as `unattended`; its permissions do not change. Unused tokens are the safeguard against forgotten service accounts: a token that is not used for `apiTokens.unusedNoticeDays` triggers a notice, and an expiry, when set or required, stops it.

Deactivating a service account revokes all its tokens at once.

## API tokens

There are personal tokens, which act as their owner, and tokens of service accounts.

- A token is `ph_` followed by 43 base62 characters (256 bits of randomness) and a six-character checksum, so secret scanners recognize it and clients can reject typos without a request. Only a hash is stored; the token is shown once, when it is created.
- Scopes are permission areas with `view` or `manage`, for the instance and for organizations, optionally limited to one organization. A token limited to one organization has no instance scopes and grants nothing outside that organization. At every request the token can do only what both its scopes and the current permissions of its owner allow. A token for a service account is created only when what it allows, its scopes intersected with the service account's roles, is covered by the creator's own permanent permissions.
- Tokens have no expiry unless one is set when creating them. The maximum lifetime of API tokens, `apiTokens.maxLifetimeDays` in days, is empty by default. When the instance or an organization sets it, every new token needs an expiry within it, and a token created without one gets the maximum; lower levels may only shorten it, and cannot remove it. A personal token follows the strictest value of every organization it reaches: its own organization if it is limited to one, otherwise every organization its owner belongs to. `GET /api/v1/account/tokens/lifetime` and `GET /api/v1/service-accounts/{id}/tokens/lifetime` return the maximum that applies to a new token, or null. `expiryRequired` and `expiryTooLate` problems carry `maxLifetimeDays`.
- The owner, or every responsible person of a service account and, without any, the organization's owners, get an e-mail `apiTokens.expiryReminderDays` (default 7) before a token expires.
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

## Templates

Templates can be exported and imported as files ([templates.md](templates.md) describes the format and the checks). Every level has the same routes; the permission is the one that manages templates at that level: `space.manage` for `/api/v1/spaces/{spaceId}/…`, `organization.templates.manage` for `/api/v1/organizations/{organizationId}/…` and `instance.templates.manage` for `/api/v1/instance/…`.

| Endpoint | What it does |
|---|---|
| `POST …/templates/export-summary` | Lists per template what an export removes, for the body `{ "templateIds": [...] }` or `null` for all. |
| `POST …/templates/export` | Sends the template file: `application/json` without files, `application/zip` with files. |
| `POST /api/v1/instance/templates/built-in/export` | Sends built-in templates in a language: `{ "language": "de", "templateIds": null }`. |
| `POST …/template-imports?name=<file name>` | Uploads a template file as `application/octet-stream` and returns a preview with an `id`. Nothing is saved. |
| `GET …/template-imports/{id}/files/{fileId}/content` | Sends a checked file of the preview, for showing its images. Only the person who uploaded it can read it. |
| `POST …/template-imports/{id}/confirm` | Imports. `decisions` holds per template `{ "index": 0, "action": "create" \| "replace" \| "skip", "name": "…" }`; `skipInvalid: true` imports the valid templates when others are not valid. |
| `DELETE …/template-imports/{id}` | Discards the preview. Previews are discarded after 12 hours anyway. |
| `POST …/templates/{templateId}/files?name=<file name>` | Adds an image to a template; use the returned `id` as `attachmentId` in the content. |
| `GET …/templates/{templateId}/files/{fileId}/content` | Sends a file of a template. In a space, templates of the instance and the organization need `space.edit`. |

A template whose name exists at the level appears in the preview with `conflict: { templateId, suggestedName }`; confirming it without a decision is refused with `templateNameTaken`. `replace` keeps the ID of the existing template. Problems with the file as a whole come as Problem Details: `invalidTemplateFile`, `newerTemplateFormat` (with `fileVersion` and `supportedVersion`), `tooManyTemplates`, `tooManyTemplateFiles`, `templateArchiveTooLarge`, `templateArchiveCompression`, `unsafeTemplateArchive`, `nestedTemplateArchive`, `unexpectedTemplateEntry`, `fileTooLarge` and `storageFull`. Problems of single templates are listed in the preview under `problems` and, on a confirmation without `skipInvalid`, in `templateProblems` of `invalidTemplatesInFile`.

```sh
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"templateIds": null}' -o templates.pagehall-template.zip \
  https://wiki.example.org/api/v1/spaces/$SPACE/templates/export

curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/octet-stream" \
  --data-binary @templates.pagehall-template.zip \
  "https://wiki.example.org/api/v1/spaces/$OTHER_SPACE/template-imports?name=templates.pagehall-template.zip"
```
