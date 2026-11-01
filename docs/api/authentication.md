# Authentication

Scripts authenticate with API tokens. This page describes what a token is, what it may do and when it stops working. The full reference of every route, with the permission it needs, is at `/api/docs` on your instance; it needs a sign-in or a token unless the instance setting **Public API reference** is on (see [Reference](conventions.md#reference)).

## Tokens

- A token is `ld_` followed by 43 base62 characters (256 bits of randomness) and a six-character checksum. Secret scanners recognize the prefix, and a client can reject a mistyped token without a request.
- Lunedo stores only a hash. The token is shown once, when it is created.
- Send it in the `Authorization` header: `Authorization: Bearer ld_...`. Tokens in the query string or in a cookie are not read.
- A request that carries both a session cookie and a token is refused with `ambiguousCredentials`.
- Requests with a token and without cookies need no cross-site request header.
- The last use of a token, with time and client address, is recorded at most once per minute.

There are two kinds of tokens:

| Kind | Acts as | Where it is managed |
|---|---|---|
| Personal token | Your own account | **Settings › My account › Sign-in and security**, section **API tokens** |
| Service account token | A service account of an organization | **Settings › Organization › Integrations and security › Service accounts** |

Organization administrators with the integrations area see and revoke, under **Settings › Organization › Integrations and security › API tokens**, the tokens limited to their organization and the tokens of accounts whose home organization it is, including its service accounts. See [Service accounts](../admin/service-accounts.md).

Tokens are created, changed and revoked only in the interface. The routes behind these screens serve the web client, need a signed-in session and are not part of `/api/docs`. A token cannot create, list or revoke tokens.

## Scopes

When you create a token, you choose its scopes: permission areas of the instance and of organizations, each with `view` or `manage`.

| Level | Areas |
|---|---|
| Instance | `organizations`, `accounts`, `signInAndSecurity`, `settings`, `operations`, `auditLog` |
| Organization | `membersAndGroups`, `spaces`, `settings`, `signInAndSecurity`, `integrationsAndApi`, `auditLog` |

- At every request, the token can do only what both its scopes and the current permissions of its account allow. A token never does more than its account, and losing a role takes effect on the next request.
- A token can be limited to one organization. It then has no instance scopes and grants nothing outside that organization.
- A service account has no instance permissions, so its tokens have no instance scopes. Its tokens are always limited to its organization.
- A token for a service account is created only when what it allows, its scopes intersected with the service account's roles, is covered by the permanent permissions of the person who creates it.
- Reading spaces, pages and articles needs the organization area `spaces` with at least `view`. A token without it reaches no content.

A request that the scopes do not cover is refused with `forbidden`, and `denials` contains `tokenScope`.

## Content access

What a token may do with content (spaces, pages, articles) is its content level. It is shown in every list of tokens.

| Level | In the interface | What the token may do |
|---|---|---|
| `read` | Read | Read everything its account can read. Nothing is changed, not even reactions. |
| `draft` | Write drafts | Also create knowledge base articles and save their drafts through the [article routes](knowledge-base-articles.md). A person publishes them. No publishing, moving, deleting, sharing or restricting, and no saving of pages in live mode. |
| `publish` | Write and publish | Write and publish like its account. |

- `draft` and `publish` need the organization area `spaces` with `manage`. Without a level, a token gets `publish` when `spaces` is `manage`, otherwise `read`.
- A token can be limited to selected knowledge bases (1 to 100). It then reaches no other space, also not in search.
- An account that may only read a knowledge base cannot write to it, whatever the level of its token.
- The level and the knowledge bases can be changed later in the token list with **Change rights**. Changing them needs a recent sign-in.

Creating a token is recorded in the audit log with its level, every change of the level as `apiToken.levelChanged`, and every publication with a token as `page.published` with the token's ID in `credentialId`.

## Lifetime

- A token has no expiry unless one is set when it is created.
- The setting **Maximum lifetime of API tokens** (`apiTokens.maxLifetimeDays`, 1 to 3650 days, empty by default) can be set for the instance and lowered by an organization. When it applies, a new token without an expiry gets the maximum; an explicit `null` expiry or a later date is refused.
- A personal token follows the lowest maximum of every organization it reaches: the one it is limited to, otherwise every organization its owner belongs to.
- Before a token expires, its owner gets a notification, by default 7 days ahead (`apiTokens.expiryReminderDays`). For a service account its responsible people get it, and without any the organization's owners.
- A token that is not used for a while (`apiTokens.unusedNoticeDays`, default 90 days) triggers a notification to the same people. The token keeps working.
- A token stops working when it expires, when it is revoked, and while its account is not active. Deactivating a service account revokes all its tokens.

## Routes a token cannot use

Some routes refuse tokens with `sessionRequired`:

- routes that need a recent sign-in, such as merging or anonymizing accounts (`POST /api/v1/instance/accounts/{accountId}/merge`, `…/anonymize`) and appointing oneself space admin;
- routes that act for the person at the screen, such as asking for access, withdrawing or reading one's own access requests, **Shared with me**, announcements and following a blog.

The reference at `/api/docs` names this for each such route. Tokens also never open collaboration connections; scripts change pages through `PUT /api/v1/pages/{pageId}/content` instead (see [Document format](document-format.md)).

## Problem codes

| Code | Status | Meaning | What to do |
|---|---|---|---|
| `invalidApiToken` | 401 | The token is malformed, unknown, revoked or expired, or its account is not active. The answer carries `WWW-Authenticate: Bearer error="invalid_token"`. | Check the token; create a new one if it was revoked or expired. |
| `ambiguousCredentials` | 400 | The request carries a session cookie and a token. | Send only the token. |
| `forbidden` with `tokenScope` | 403 | The scopes or the content level of the token do not cover the request. | Create a token with the needed scope or level. |
| `forbidden` | 403 | The account itself lacks the permission. | Ask for the role. |
| `sessionRequired` | 403 | The route is not available to tokens. | Use the interface. |
| `notFound` | 404 | The space or page lies outside the knowledge bases the token is limited to. | Use a token that reaches that knowledge base. |
| `rateLimited` | 429 | The token sent more requests per minute than the instance setting **Requests per token** allows, 600 by default (see [Service accounts](../admin/service-accounts.md#tokens-and-reminders)). | Wait for `Retry-After` seconds. |

Unknown, revoked and expired tokens and tokens of inactive accounts are recorded in the audit log as `apiToken.rejected`, at most ten times per minute per client address. Malformed tokens are not recorded. Successful use is not recorded.
