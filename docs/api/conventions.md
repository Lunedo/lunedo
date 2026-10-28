# API conventions

Rules that hold for every route of the API. The full reference, with each route's fields, errors and examples, is at `/api/docs` on your instance; the OpenAPI description behind it is at `/api/docs/openapi.json`.

## Reference

`/api/docs` is served by the instance itself: the page, the renderer and the description load nothing from other hosts. Signed-in people and requests with an API token can open it. The instance setting **Public API reference** (`apiTokens.publicDocumentation`, under **Settings › Instance › People and sign-in › Policies**) opens it to everyone.

Each route in the reference names the permission it needs, in the text and in `x-lunedo-permission`. Routes that serve only the web client are internal: they are left out of the reference and can change at any time. Scripts use only the routes listed at `/api/docs`.

## Versions

- Every route is versioned under `/api/v1`.
- Responses contain only the fields their schema declares. Ignore fields you do not know.
- Lists of values marked `x-extensible-enum` in the description can gain values. Handle values you do not know, for example by skipping the entry or treating it as "other". Closed lists use a plain `enum`.

## Requests and responses

- Request and response bodies are JSON (`application/json`), except uploads, which send the bytes as `application/octet-stream`, and downloads.
- IDs are UUIDs. Content also has numbers, which appear in addresses; see [Content numbers and addresses](../user/spaces-and-pages/content-addresses.md#content-numbers-and-addresses).
- Timestamps are ISO 8601. Responses use UTC; requests may carry an offset.
- Boolean query parameters are written `true` or `false`.
- Every response carries `X-Request-Id`. The audit log records the same ID, so give it when you report a problem.
- Content the caller may not see behaves like content that does not exist: the answer is `404`, and lists leave it out.

## Errors

Errors are Problem Details (RFC 9457) with the media type `application/problem+json`:

```json
{
  "type": "urn:lunedo:problem:invalidInput",
  "title": "The request is not valid",
  "status": 400,
  "detail": "The request is not valid",
  "code": "invalidInput",
  "fields": ["title"]
}
```

- `type` is stable. Branch on it or on `code`, which repeats its last part. `title` and `detail` are for people and can change.
- Some problems carry more fields, for example `fields` for invalid input, `denials` for `forbidden`, `retryAfterSeconds` for `rateLimited` and `busy`, and `problems` for `invalidDocument`.
- The reference lists the problems each route can return.

Common problems:

| Code | Status | Meaning |
|---|---|---|
| `invalidInput` | 400 | A field is missing or invalid; `fields` names it. |
| `invalidApiToken` | 401 | The token is not valid. See [Authentication](authentication.md#problem-codes). |
| `notSignedIn` | 401 | The request carries neither a token nor a session. |
| `forbidden` | 403 | Not allowed; `denials` says why. |
| `sessionRequired` | 403 | The route does not accept tokens. |
| `notFound` | 404 | Unknown, or not visible to the caller. |
| `clientOutdated` | 409 | The `X-Lunedo-Client-Api` header names an older level than the server accepts. |
| `payloadTooLarge` | 413 | The body is too large. |
| `unsupportedMediaType` | 415 | The body has the wrong type. |
| `rateLimited` | 429 | Too many requests; wait for `Retry-After` seconds. |
| `internalError` | 500 | Unexpected error; the log of the instance has the details. |
| `busy` | 503 | The server is busy; try again after `Retry-After` seconds. |
| `maintenanceMode` | 503 | The instance is in maintenance mode and saves no changes; `maintenanceMessage` holds the administrators' note. |
| `storageFull` | 507 | The file store is almost full; uploads or large writes are refused. |

## Paging

Lists return one page at a time:

```json
{ "items": [], "nextCursor": "eyJ..." }
```

- Pass `nextCursor` as the `cursor` query parameter to get the next page, until `nextCursor` is `null`.
- `limit` sets the page size. For most lists it is 1 to 200, default 50; the reference names the routes with other limits, such as the page tree (default 200).
- The cursor is opaque. Do not build or change it; a changed cursor is refused with `invalidInput` naming the field `cursor` (`invalidCursor` on some routes).

```sh
CURSOR=""
while :; do
  PAGE=$(curl -s -H "Authorization: Bearer $TOKEN" \
    "https://wiki.example.com/api/v1/spaces?limit=200${CURSOR:+&cursor=$CURSOR}")
  echo "$PAGE" | jq -c '.items[]'
  CURSOR=$(echo "$PAGE" | jq -r '.nextCursor // empty')
  [ -z "$CURSOR" ] && break
done
```

## Filters

Lists take their filters as query parameters, for example `organizationId` and `type` on `GET /api/v1/spaces`, or `from`, `to` and `name` on the audit log. Filters combine with AND. The reference lists the filters of each route; parameters it does not list are refused with `invalidInput`.

## Rate limits

- Each token may send `apiTokens.requestsPerMinute` requests per minute, 600 by default. Instance administrators change it under **Settings › Instance › People and sign-in › Policies**.
- The count is kept in the database for a window of one minute, so the limit holds across all nodes of the instance.
- Above the limit, the API answers `429` with the problem `rateLimited`, a `Retry-After` header and `retryAfterSeconds`.

## Cross-site requests

State-changing requests with a session cookie need the header `X-Lunedo-Request` and a matching `Origin`. Requests with a token and without cookies are exempt; scripts need neither.

## X-Lunedo-Client-Api

The web client sends its API level in the header `X-Lunedo-Client-Api`. When the level is older than the server accepts, for example in a browser tab left open across an update, the server answers `409` with `clientOutdated`. Scripts leave the header out; requests without it are accepted.
