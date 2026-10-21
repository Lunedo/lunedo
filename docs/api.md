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

### Content access and write levels

What a token may do with content (spaces, pages, articles) is set when it is created and shown in every token list:

| Level | In the interface | What the token may do |
|---|---|---|
| `read` | Read | Read everything its account can read. Nothing is changed, not even reactions. |
| `draft` | Write drafts | Also create articles and save drafts of knowledge base articles through the article API. A person publishes them in Pagehall. It changes nothing readers see: no publishing, no moving, deleting, sharing or restricting, and no saving of pages in live mode. |
| `publish` | Write and publish | Write and publish like its account. |

`draft` and `publish` need the organization area `spaces` with `manage`; `read` needs `view`. Left out, the level is `publish` for `manage` and `read` otherwise. A token can also be limited to selected knowledge bases with `knowledgeBaseIds`; it then reaches no other space, also not in search. A token never does more than its account may: an account that only reads a knowledge base cannot write to it, whatever the token's level.

The level and the knowledge bases can be changed later with `PUT /api/v1/account/tokens/{id}/content-access` or `PUT /api/v1/service-accounts/{id}/tokens/{tokenId}/content-access`. Creating a token is recorded in the audit log as `apiToken.created` with its level, every change as `apiToken.levelChanged`, and every publication with a token as `page.publishedWithToken`, besides `page.published`.

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

## Knowledge base articles

Programs such as a helpdesk chatbot read the articles of a knowledge base and can write reviewed articles back. They use an API token of a service account that has a role in the knowledge base: reader for reading, editor for writing. See [knowledge-bases.md](knowledge-bases.md) for articles, categories, sections and languages.

| Endpoint | Permission | What it does |
|---|---|---|
| `GET /api/v1/spaces/{spaceId}/article-changes` | read the knowledge base | New, changed and removed articles since `changedSince`, paged with `cursor` |
| `GET /api/v1/articles/{itemId}` | read the article | One article; `draft=true` returns the draft to editors and draft tokens |
| `POST /api/v1/spaces/{spaceId}/articles` | write drafts | Create an article or, with `translationOf` and `language`, a translation; `publish: true` publishes at once with a publishing token |
| `POST /api/v1/articles/{itemId}/images?name=…` | write drafts | Upload an image, sent as `application/octet-stream` |
| `PUT /api/v1/articles/{itemId}/draft` | write drafts | Save title and sections as the draft; type, category and lead of a published article need permission to publish |
| `POST /api/v1/articles/{itemId}/publish` | publish | Publish the draft |

Every article in a response has its number, short form (`slug`), language, type, category path, title, lead, its sections with key, title, HTML and plain text, the images with alternative text and the address of their display version, the dates of first publication, of the returned version and of the last review, and its address in the portal. Images and links inside the HTML point to the API and the portal. Only published versions are returned, unless a token that may write drafts asks for `draft=true`. Articles the token's account cannot read are never returned.

Sections are written as Markdown or as ProseMirror JSON nodes. Markdown references uploaded images by their file name. Every change is a version or a draft with the token's service account as its author, like a change in the interface, and old versions can be restored in the history. `versionNote`, for example "Checked by Anna Huber in the help assistant", is stored with the draft and appears in the history of the version that publishes it.

### Changes and removed articles

`article-changes` returns the articles, oldest change first, that changed after `changedSince`: new, republished, renamed, moved, retyped, reviewed, restricted or unrestricted articles, articles in renamed categories and new or changed translations. `removed` lists the number and language of articles that were deleted, unpublished or moved to another space since then. Removed articles are known for 90 days; an older `changedSince` is refused with `changedSinceTooOld`, and the program fetches everything again. Without `changedSince` the endpoint lists every published article and no removed ones.

Store `nextChangedSince` of the last page and send it as `changedSince` next time. It lies a few minutes in the past, so that changes saved at the same moment are not missed; articles can therefore appear twice and are best stored by ID. An article that becomes hidden from the token's account through a view restriction is not listed as removed, and neither is an article that had a view restriction when it was removed, because its number would reveal it; programs that must forget such articles fetch everything again from time to time.

### Example: daily read sync

```sh
SINCE=$(cat last-sync 2>/dev/null)
CURSOR=""
while :; do
  PAGE=$(curl -s -H "Authorization: Bearer $TOKEN" \
    "https://wiki.example.org/api/v1/spaces/$SPACE/article-changes?limit=200${SINCE:+&changedSince=$SINCE}${CURSOR:+&cursor=$CURSOR}")
  echo "$PAGE" | jq -c '.items[]' | while read -r article; do store "$article"; done
  echo "$PAGE" | jq -c '.removed[]' | while read -r gone; do forget "$gone"; done
  CURSOR=$(echo "$PAGE" | jq -r '.nextCursor // empty')
  [ -z "$CURSOR" ] && break
done
echo "$PAGE" | jq -r '.nextChangedSince' > last-sync
```

`store` keeps an article by `id` (or by `number` and `language`) with its `sections[].text` for the search index and `portalUrl` for the answer; `forget` removes the article with that `itemId`.

### Example: write a reviewed article back

As a draft, with a token of the level `draft`:

```sh
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"sections": [{"key": "steps", "title": "Steps", "markdown": "1. Open the VPN client.\n2. Sign in with your new code."}],
       "versionNote": "Checked by Anna Huber in the help assistant"}' \
  https://wiki.example.org/api/v1/articles/$ARTICLE/draft
```

The draft waits in Pagehall until a person publishes it; the publish dialog takes over the note. With a token of the level `publish`, publish it directly:

```sh
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"versionNote": "Checked by Anna Huber in the help assistant"}' \
  https://wiki.example.org/api/v1/articles/$ARTICLE/publish
```

A new article with an image is created as a draft, the image uploaded and the sections saved with a reference to it:

```sh
ARTICLE=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title": "Set up the VPN connection", "type": "howTo", "categoryId": "'"$CATEGORY"'"}' \
  https://wiki.example.org/api/v1/spaces/$SPACE/articles | jq -r .id)
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/octet-stream" \
  --data-binary @client.png "https://wiki.example.org/api/v1/articles/$ARTICLE/images?name=client.png"
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"sections": [{"key": "steps", "title": "Steps", "markdown": "![Sign-in window](client.png)"}]}' \
  https://wiki.example.org/api/v1/articles/$ARTICLE/draft
```

### Example: download the static website

A script can rebuild the static website of a public knowledge base, for example every night, with a token of a space admin (see [knowledge-bases.md](knowledge-bases.md#static-website)):

```sh
EXPORT=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"format": "site", "siteUrl": "https://help.example.org/"}' \
  https://wiki.example.org/api/v1/spaces/$SPACE/exports | jq -r .id)
while :; do
  STATE=$(curl -s -H "Authorization: Bearer $TOKEN" https://wiki.example.org/api/v1/exports/$EXPORT | jq -r .state)
  [ "$STATE" = ready ] && break
  [ "$STATE" = failed ] && exit 1
  sleep 10
done
curl -s -H "Authorization: Bearer $TOKEN" -o site.zip https://wiki.example.org/api/v1/exports/$EXPORT/content
unzip -o site.zip -d site && npx wrangler pages deploy site --project-name=help
```
