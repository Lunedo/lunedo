# Knowledge base articles

Programs such as a helpdesk chatbot or a migration script read the articles of a knowledge base and can write articles back. [Knowledge bases](../user/knowledge-bases.md) explains articles, areas and topics, sections and languages. The full reference is at `/api/docs` on your instance.

## Token

Use a token of a service account that has a role in the knowledge base: reader for reading, editor for writing. See [Service accounts](../admin/service-accounts.md) and [Authentication](authentication.md).

| The program should | Token scope | Content level |
|---|---|---|
| Read articles | organization area `spaces` with `view` | `read` |
| Write drafts that a person publishes in Lunedo | organization area `spaces` with `manage` | `draft` |
| Write and publish | organization area `spaces` with `manage` | `publish` |

A token can be limited to selected knowledge bases; it then reaches no other space. Articles the token's account cannot read are never returned.

## Routes

| Route | What it does | Permission |
|---|---|---|
| `GET /api/v1/spaces/{spaceId}/articles` | Original articles the caller can read, most recently changed first; filters `categoryId`, `topLevel=true`, `type` | read the knowledge base |
| `GET /api/v1/articles/{itemId}` | One article with its sections; `draft=true` returns the draft to its editors | read the article |
| `GET /api/v1/spaces/{spaceId}/article-changes` | New, changed and removed articles since `changedSince` | read the knowledge base |
| `POST /api/v1/spaces/{spaceId}/articles` | Creates an article, or a translation with `translationOf` and `language` | write drafts |
| `POST /api/v1/articles/{itemId}/images?name=` | Uploads an image, sent as `application/octet-stream` | write drafts |
| `PUT /api/v1/articles/{itemId}/draft` | Saves title, lead and sections as the draft | write drafts |
| `POST /api/v1/articles/{itemId}/publish` | Publishes the draft | publish |
| `PUT /api/v1/articles/{itemId}/type` | Sets the type (`howTo`, `troubleshooting`) or removes it with `null` | edit the article |
| `GET /api/v1/articles/{itemId}/translations` | The original and one entry per enabled language with the state of its translation | read the article |
| `POST /api/v1/articles/{itemId}/translations` | Adds a translation, `{ "language": "en" }`, with a copy of the original's content to translate | edit the article |
| `GET /api/v1/spaces/{spaceId}/categories` | Every area and topic the caller can read, with depth, introduction, icon and contact address | read the knowledge base |
| `GET /api/v1/spaces/{spaceId}/knowledge-base/templates` | The article templates with their sections | read the knowledge base |

The API calls areas and topics categories. Create them as folders with `POST /api/v1/spaces/{spaceId}/items` and `"kind": "folder"`.

## Articles in responses

Every article carries:

- `id`, `number`, `slug` and `portalUrl`. A translation carries the number of its original; `number` and `language` together name an article in one language. In the app, translations have numbers of their own, which `GET …/translations` returns as `itemNumber`.
- `language`, `translationOf` and the state of its translations,
- `type`, `categoryPath` (the folders above it from the top level down, as far as the caller can see them), `title`, `lead` and `contactEmail`,
- `sections`, each with `key`, `title`, `icon`, `text`, `html` and `content` (ProseMirror JSON), and the whole `document`,
- `images` with `alt` and the `url` of their display version in the API,
- `publishedAt`, `versionPublishedAt` and `lastReviewedAt`.

Images and links inside the HTML point to the API and the portal. Only published versions are returned, unless an editor asks for `draft=true`.

## Writing articles

Sections are written as Markdown (`markdown`) or as ProseMirror JSON nodes (`content`); see [Document format](document-format.md). Markdown references uploaded images by their file name. The sections of a draft replace its whole content.

- Every change is a version or a draft with the token's service account as its author, like a change in the interface. Old versions can be restored in the history.
- `versionNote` (up to 1000 characters), for example "Checked by Lena Vogt in the help assistant", is stored with the draft and appears in the history of the version that publishes it.
- Type, category and lead of a published article change at once for readers, so they need permission to publish.
- `publish: true` when creating publishes at once; with a token of the level `draft` it is refused with `publishNotAllowed`.
- Publishing is refused with `requiredSectionsEmpty` while a section that the template requires is empty.

Write a draft with a token of the level `draft`:

```sh
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"sections": [{"key": "steps", "title": "Steps", "markdown": "1. Open the VPN client.\n2. Sign in with your new code."}],
       "versionNote": "Checked by Lena Vogt in the help assistant"}' \
  https://wiki.example.com/api/v1/articles/$ARTICLE/draft
```

The draft waits in Lunedo until a person publishes it; the publish dialog takes over the note. With a token of the level `publish`, publish it directly:

```sh
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"versionNote": "Checked by Lena Vogt in the help assistant"}' \
  https://wiki.example.com/api/v1/articles/$ARTICLE/publish
```

Create an article, upload an image and save the sections that reference it:

```sh
ARTICLE=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title": "Set up the VPN connection", "type": "howTo", "categoryId": "'"$CATEGORY"'"}' \
  https://wiki.example.com/api/v1/spaces/$SPACE/articles | jq -r .id)
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/octet-stream" \
  --data-binary @client.png "https://wiki.example.com/api/v1/articles/$ARTICLE/images?name=client.png"
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"sections": [{"key": "steps", "title": "Steps", "markdown": "![Sign-in window](client.png)"}]}' \
  https://wiki.example.com/api/v1/articles/$ARTICLE/draft
```

## Changes and removed articles

`GET …/article-changes` returns the articles, oldest change first, that changed after `changedSince`: new, republished, renamed, moved, retyped, reviewed, restricted or unrestricted articles, articles in renamed categories and new or changed translations. It pages with `cursor` and `limit` (1 to 200, default 50).

`removed` lists the articles readers can no longer find under their number and language since then:

| Field | Meaning |
|---|---|
| `itemId` | ID the article had |
| `number` | number the article had, or `null` |
| `language` | language of the removed article or translation |
| `reason` | `deleted` (in the trash or deleted), `unpublished` (no longer readable) or `moved` (to another space) |
| `removedAt` | when it was removed |

- Removed articles are known for 90 days. An older `changedSince` is refused with `changedSinceTooOld`; fetch everything again.
- Without `changedSince`, the route lists every published article and no removed ones.
- Store `nextChangedSince` of the last page and send it as `changedSince` next time. It lies a few minutes in the past, so that changes saved at the same moment are not missed. Articles can therefore appear twice; store them by `id`.
- An article that becomes hidden from the token's account through a view restriction is not listed as removed, and neither is an article that had a view restriction when it was removed, because its number would reveal it. Programs that must forget such articles fetch everything again from time to time.

### Example: daily read sync

```sh
SINCE=$(cat last-sync 2>/dev/null)
CURSOR=""
while :; do
  PAGE=$(curl -s -H "Authorization: Bearer $TOKEN" \
    "https://wiki.example.com/api/v1/spaces/$SPACE/article-changes?limit=200${SINCE:+&changedSince=$SINCE}${CURSOR:+&cursor=$CURSOR}")
  echo "$PAGE" | jq -c '.items[]' | while read -r article; do store "$article"; done
  echo "$PAGE" | jq -c '.removed[]' | while read -r gone; do forget "$gone"; done
  CURSOR=$(echo "$PAGE" | jq -r '.nextCursor // empty')
  [ -z "$CURSOR" ] && break
done
echo "$PAGE" | jq -r '.nextChangedSince' > last-sync
```

`store` keeps an article by `id` with its `sections[].text` for the search index and `portalUrl` for the answer; `forget` removes the article with that `itemId`.

## Reviews

| Route | What it does | Permission |
|---|---|---|
| `GET /api/v1/spaces/{spaceId}/knowledge-base/reviews` | Default interval, lead time and who is reminded | read the knowledge base |
| `PUT /api/v1/spaces/{spaceId}/knowledge-base/reviews` | Changes them | space admin |
| `GET /api/v1/spaces/{spaceId}/reviews` | Articles that are overdue, due within 30 days, whose source page changed or that have no active owner; only articles the caller may edit | read the knowledge base |
| `GET /api/v1/reviews/mine` | The caller's own articles that need a review | signed in or token |
| `GET /api/v1/articles/{itemId}/review` | Interval, last review and due date | read the article |
| `PUT /api/v1/articles/{itemId}/review/interval` | An interval of the article's own, `0` for none, or `null` to inherit | edit the article |
| `POST /api/v1/articles/{itemId}/reviews` | Marks the article as reviewed, without a new version | edit the article |
| `DELETE /api/v1/articles/{itemId}/reviews/{reviewId}` | Undoes the latest review, only by the person who recorded it and within two minutes | edit the article |
| `GET`, `POST /api/v1/articles/{itemId}/sources`, `DELETE …/sources/{sourceId}` | Source pages the caller can read | read, edit the article |
| `GET`, `DELETE /api/v1/articles/{itemId}/hidden-sources` | Counts and removes the linked source pages the caller cannot read | edit the article |

`POST /api/v1/pages/{pageId}/publish` accepts `"reviewed": true` for articles. Reviews also appear in `GET /api/v1/items/{itemId}/activity` with the type `review`. `GET …/review` returns `reviewedAt` and `effectiveIntervalMonths`; the portal shows "Last reviewed on" with that date while an interval applies and the article was reviewed at least once. See [Reviews](../user/knowledge-base-reviews.md).

## Problems

| Code | Meaning |
|---|---|
| `notKnowledgeBase` | The space is not a knowledge base. |
| `notArticle` | The item is not an article. |
| `draftNotVisible` | Only editors see the draft. |
| `publishNotAllowed` | The token or account may not publish. |
| `requiredSectionsEmpty` | A required section is empty. |
| `changedSinceTooOld` | `changedSince` lies more than 90 days back. |
| `translationExists` | The article already has a translation into this language. |
| `invalidDocument` | A section does not match the editor schema. |
