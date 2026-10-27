# Spaces and pages

Routes for spaces, the page tree, page content, versions, attachments and exports. [Spaces and pages](../user/spaces-and-pages.md) explains the concepts. This page lists the main routes; the full reference, with every field and error, is at `/api/docs` on your instance.

Permissions are named as in the reference. `space.view`, `item.view` and similar actions follow the role in the space: reader, commenter, editor or space admin.

## Spaces

| Route | What it does | Permission |
|---|---|---|
| `GET /api/v1/spaces` | Spaces the caller can read, by name; filters `organizationId`, `type`, `archived` | signed in or token |
| `GET /api/v1/spaces/{spaceId}` | One space | `space.view` |
| `GET /api/v1/space-keys/{key}` | Finds a space by its key | signed in or token |
| `POST /api/v1/organizations/{organizationId}/spaces` | Creates a space; `type: "knowledgeBase"` creates a knowledge base | `organization.spaces.create` |
| `PATCH /api/v1/spaces/{spaceId}` | Changes name and description | `space.manage` |
| `PUT /api/v1/spaces/{spaceId}/key` | Changes the key | `space.manage` |
| `POST /api/v1/spaces/{spaceId}/visibility/preview`, `PUT …/visibility` | Previews and changes who can read the space | `space.manage` |
| `GET`, `POST /api/v1/spaces/{spaceId}/permissions`, `POST …/permissions/preview` | Lists, previews and changes roles in the space | `space.manage` |
| `PUT /api/v1/spaces/{spaceId}/archived` | Archives a space or brings it back | `space.manage` |
| `POST /api/v1/spaces/{spaceId}/delete` | Moves the space to the trash; needs the name of the space typed as confirmation | `space.delete` |

The previews return who gains or loses access or gets another role. People the caller may not see are counted but not named.

## The page tree

| Route | What it does | Permission |
|---|---|---|
| `GET /api/v1/spaces/{spaceId}/items` | Root items, or the children of `parentId`, in tree order | `space.view` |
| `POST /api/v1/spaces/{spaceId}/items` | Creates a page, folder, link or whiteboard, optionally from a template | `space.edit` |
| `GET /api/v1/items/{itemId}` | One item with its space and ancestors | `item.view` |
| `GET /api/v1/items/by-number/{number}` | The same, by the item's number | `item.view` |
| `GET /api/v1/items?q=` | Finds pages and folders by title | signed in or token |
| `PATCH /api/v1/items/{itemId}` | Changes title, folder description, page width or heading numbers | `item.edit` |
| `POST /api/v1/items/{itemId}/move/preview`, `…/move` | Previews and moves an item with its children, also to another space | `item.edit` |
| `POST /api/v1/items/{itemId}/copy/preview`, `…/copy` | Previews and copies an item, optionally with everything below it | `item.view` |
| `GET /api/v1/copies/{copyId}` | Progress of a copy that runs in the background | `copy.view` |
| `POST /api/v1/items/{itemId}/archive`, `…/unarchive` | Archives an item or brings it back | `item.archive` |
| `DELETE /api/v1/items/{itemId}` | Moves an item with its descendants to the trash | `item.delete` |
| `GET /api/v1/spaces/{spaceId}/trash`, `POST …/trash/{entryId}/restore` | Lists and restores the trash of a space | `space.trash` |

Blog posts are created with `POST /api/v1/spaces/{spaceId}/blog`, not in the tree.

### Numbers

Every item has a `number` from one sequence per instance that starts at 1000. It never changes and is never reused; a copy gets a new number. Addresses in the app use it, for example `/spaces/OPS/pages/1042/vpn-access`. `GET /api/v1/items/by-number/{number}` answers like `GET /api/v1/items/{itemId}`; an unknown number and a number the caller cannot read give the same `404`. The ID stays the key in the API, in links inside content and in exports. See [Content addresses](../user/content-addresses.md#content-numbers-and-addresses).

### Moving and copying

A move or copy that changes who can access the content, through roles or inherited view restrictions, is refused until the request carries the `confirmation` from a preview of exactly that change. Moving to another space needs edit permission in both spaces. See [Copying](../user/copying.md#copying).

## Content and versions

| Route | What it does | Permission |
|---|---|---|
| `GET /api/v1/pages/{pageId}/content` | Content readers see, as JSON | `item.view` |
| `GET /api/v1/pages/{pageId}/markdown` | The same as Markdown | `item.view` |
| `PUT /api/v1/pages/{pageId}/content` | Replaces the content | `item.edit` |
| `GET /api/v1/pages/{pageId}/draft` | The draft of a page in publish mode | `item.edit` |
| `POST /api/v1/pages/{pageId}/publish` | Publishes the draft as a new version | `item.publish` |
| `PUT /api/v1/pages/{pageId}/mode` | Switches between publish and live mode | `item.publish` |
| `GET /api/v1/pages/{pageId}/versions`, `…/versions/{number}` | Versions of a page | `item.view` |
| `POST /api/v1/pages/{pageId}/versions/{number}/restore` | Restores a version | `item.publish` |
| `GET /api/v1/pages/{pageId}/compare` | Compares two versions | `item.view` |
| `GET`, `POST /api/v1/pages/{pageId}/labels`, `DELETE …/labels/{label}` | Labels of a page | `item.view`, `item.edit` |
| `PUT /api/v1/items/{itemId}/status` | Sets or removes the status of a page | `item.edit` |
| `PUT /api/v1/items/{itemId}/owner` | Gives an item a new owner | `item.transferOwnership` |

[Document format](document-format.md) describes the JSON content. Publishing a draft without changes creates no new version, also when two requests publish at the same moment.

## Attachments

| Route | What it does | Permission |
|---|---|---|
| `GET /api/v1/pages/{pageId}/attachments` | Files of a page with their current version | `item.view` |
| `POST /api/v1/pages/{pageId}/attachments?name=` | Uploads a file as `application/octet-stream`; the same name adds a version | `item.edit` |
| `GET /api/v1/attachments/{attachmentId}/content` | Downloads a file | `attachment.view` |
| `GET /api/v1/attachments/{attachmentId}/versions` | Versions of a file | `attachment.view` |
| `DELETE /api/v1/attachments/{attachmentId}` | Deletes a file | `attachment.edit` |

Files above the size limit of the organization are refused before anything is stored. When the file store is almost full, uploads are refused with `507` and `storageFull`; see [Storage](storage.md).

## Export

| Route | What it does | Permission |
|---|---|---|
| `GET /api/v1/pages/{pageId}/export?format=` | Exports one page at once: `markdown`, `html`, `zip`, `print`, `docx` or `pdf` | `item.export` |
| `POST /api/v1/pages/{pageId}/exports` | Exports a page with its subpages in the background | `item.exportPages` |
| `POST /api/v1/spaces/{spaceId}/exports` | Exports a space in the background | `space.export` |
| `GET …/exports/summary` | Counts what an export would contain | as above |
| `GET /api/v1/exports` | Your exports | signed in or token |
| `GET /api/v1/exports/{exportId}` | One of your exports with its state | `export.view` |
| `GET /api/v1/exports/{exportId}/content` | Downloads a finished export | `export.download` |

- Without a body, a background export is a ZIP with every page as Markdown and HTML. `format` chooses `html`, `markdown`, `print`, `pdf` or `docx`; `pdf` needs the render container of the instance.
- `state` goes from `queued` and `running` to `ready` or `failed`; a failed export names the reason in `errorCode`.
- Each person runs one export at a time and keeps up to five. A download is kept for 7 days, or 24 hours after its first complete download.
- Exporting a space needs a person's account with a role in the space: its space admins, and for spaces that are not confidential also members whose organization role manages spaces. Guests and service accounts cannot export spaces.
- Space admins can turn export off for a space; the API then answers with `exportDisabled`.

[Export](../user/export.md) describes the formats. The static website of a knowledge base is a space export with `format: "site"`; see [Knowledge base export](knowledge-base-export.md).
