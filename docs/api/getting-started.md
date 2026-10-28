# Getting started with the API

Scripts and integrations use the same HTTP API as the Lunedo web client. This tutorial creates a token, sends a first request and reads a page. Every instance describes its whole API at `/api/docs`, for example `https://wiki.example.com/api/docs`.

## Before you start

You need an account on the instance and `curl`. The examples use the instance address `https://wiki.example.com`; replace it with the address you open Lunedo with.

A personal token acts as your own account and stops working when your account does. For a script that must keep running when people leave, ask an organization administrator for a token of a service account instead; see [Service accounts](../admin/service-accounts.md).

## Create a personal token

1. Open **Settings › My account › Sign-in and security**.
2. Under **API tokens**, choose **Create token**.
3. Enter a name, for example "Space report".
4. Under **What for**, choose **Read only**. It lets the token read the spaces, pages and articles you may read and change nothing.
5. Under **Expires**, choose **30 days**.
6. Create the token. If Lunedo asks you to confirm your identity, do so; creating a token needs a recent sign-in.
7. Copy the token. It starts with `ld_` and is shown only once.

Keep the token in an environment variable for the examples:

```sh
export TOKEN='ld_...'
```

## Base address

Every route lives below `/api/v1` of the instance address:

```
https://wiki.example.com/api/v1/
```

The API answers in JSON. Send the token in the `Authorization` header of every request. Tokens in the query string are never accepted.

## Send a first request

List the spaces the token can read:

```sh
curl -s -H "Authorization: Bearer $TOKEN" https://wiki.example.com/api/v1/spaces
```

The answer is one page of a list:

```json
{
  "items": [
    {
      "id": "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a10",
      "key": "OPS",
      "type": "standard",
      "name": "Operations",
      "visibility": "organization",
      "organizationId": "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a6b",
      "organizationName": "Nordwind",
      "overviewItemNumber": 1001,
      "archived": false
    }
  ],
  "nextCursor": null
}
```

The example leaves out some fields. `nextCursor` is `null` because there is no further page; [Conventions](conventions.md#paging) explains how to page through longer lists.

An empty `items` list means that the token reaches no space: either you have no role in any space, or the token was created without access to content.

## Read a page

Every page has a number, which you see in its address in the browser, for example `https://wiki.example.com/spaces/OPS/pages/1042/vpn-access`. See [Content numbers and addresses](../user/spaces-and-pages/content-addresses.md#content-numbers-and-addresses).

1. Look up the page by its number:

   ```sh
   curl -s -H "Authorization: Bearer $TOKEN" https://wiki.example.com/api/v1/items/by-number/1042
   ```

   The answer contains the page's `id`.

2. Read the content as Markdown, with the `id` from step 1:

   ```sh
   curl -s -H "Authorization: Bearer $TOKEN" \
     https://wiki.example.com/api/v1/pages/01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5b42/markdown
   ```

   `GET /api/v1/pages/{pageId}/content` returns the same content as JSON; [Document format](document-format.md) describes it.

A number that does not exist and a page the token may not read give the same answer, `404`.

## When a request fails

Errors come as Problem Details in JSON. A mistyped or revoked token gives:

```json
{
  "type": "urn:lunedo:problem:invalidApiToken",
  "title": "The API token is not valid",
  "status": 401,
  "detail": "The API token is not valid",
  "code": "invalidApiToken"
}
```

Branch on `type` or `code`, never on `title` or `detail`. [Conventions](conventions.md#errors) lists the common codes, and [Authentication](authentication.md#problem-codes) the codes about tokens.

## Next steps

- [Authentication](authentication.md): scopes, content access and the lifetime of tokens.
- [Conventions](conventions.md): versions, errors, paging and rate limits.
- [Spaces and pages](spaces-and-pages.md): creating and changing pages.
- `/api/docs` on your instance: every route with its fields, errors and examples.
