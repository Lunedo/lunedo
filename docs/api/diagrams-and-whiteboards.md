# Diagrams and whiteboards

Routes for the files and images behind diagram blocks (draw.io, Mermaid, PlantUML), drawings in pages and whiteboards. [Diagrams](../user/blocks/diagrams.md) and [Whiteboards](../user/whiteboards.md) describe them in the interface. The full reference is at `/api/docs` on your instance.

## How blocks and files fit together

A diagram or drawing block in a page stores no image itself. Its attributes point to attachments of the page: the source file and its version, and an SVG image and its version (see [Document format](document-format.md#nodes)). To change a diagram through the API:

1. Store the new file or image with one of the routes below. The answer names the attachment and version.
2. Point the block to them in the content with `PUT /api/v1/pages/{pageId}/content`.

Every store is a new version of the attachment, so older versions of the page keep showing the diagram they had.

## Diagram blocks

| Route | What it does | Permission |
|---|---|---|
| `PUT /api/v1/pages/{pageId}/diagrams/{blockId}/drawio` | Stores the file of a draw.io diagram as the attachment `drawio-<block ID>.drawio` | `item.edit` |
| `PUT /api/v1/pages/{pageId}/diagrams/{blockId}/image?type=drawio\|mermaid\|plantuml` | Stores the SVG image of a diagram as `<type>-<block ID>.svg` | `item.edit` |
| `GET /api/v1/pages/{pageId}/diagrams/{blockId}` | The page and the current image of one of its draw.io diagrams | `item.view` |

- Send files as `application/octet-stream`.
- A draw.io file is `mxfile` or `mxGraphModel` XML of up to 4 MiB, 50,000 elements and 300,000 attributes. Compressed pages are stored uncompressed; scripts, event handlers and links other than web, mail and page links are removed. The answer has `sourceId`, `sourceVersion` and `text`.
- An image may be at most 20,000 pixels wide and high, and 10 MiB for draw.io or 2 MiB for Mermaid and PlantUML. Scripts, links, external resources and unknown elements are removed. The answer has `previewId`, `previewVersion` and `text`.
- `text` is the text of the shapes, for the block's `text` attribute and for search.

Lunedo does not render Mermaid or PlantUML on the server. The image comes from whoever saves the diagram; the web client renders it in the browser.

`GET …/diagrams/{blockId}` is what other pages use to show a diagram of this page: it always returns its current image. Pages the caller may not see are not found.

## Drawings in pages

| Route | What it does | Permission |
|---|---|---|
| `PUT /api/v1/pages/{pageId}/drawings/{blockId}/scene` | Validates and stores the scene as `drawing-<block ID>.excalidraw`, up to 8 MiB | `item.edit` |
| `PUT /api/v1/pages/{pageId}/drawings/{blockId}/preview` | Stores the SVG image as `drawing-<block ID>.svg`, up to 5 MiB | `item.edit` |

A scene has the same form as the scene of a whiteboard.

## Whiteboards

| Route | What it does | Permission |
|---|---|---|
| `POST /api/v1/spaces/{spaceId}/items` with `"kind": "whiteboard"` | Creates an empty whiteboard | `space.edit` |
| `GET /api/v1/whiteboards/{itemId}/scene` | The stored scene with its `revision` | `item.view` |
| `GET /api/v1/whiteboards/{itemId}/preview` | The SVG image of the current state or of a `version` | `item.view` |
| `PUT /api/v1/whiteboards/{itemId}/preview?revision=` | Stores the image of a saved state | `item.edit` |
| `GET /api/v1/whiteboards/{itemId}/reference` | Title, address and whether an image exists, as a whiteboard block shows it | `item.view` |
| `GET /api/v1/whiteboards/{itemId}/versions`, `…/versions/{number}` | Versions, newest first, and one version with its scene | `item.view` |
| `POST /api/v1/whiteboards/{itemId}/versions/{number}/restore` | Restores a version | `item.edit` |

- A scene has `elements` (Excalidraw elements of the types rectangle, diamond, ellipse, arrow, line, freedraw, text, image and frame), `files` (images by file ID, each an attachment of the whiteboard) and `settings`.
- The content of a whiteboard is edited together through the collaboration server, which API tokens cannot use. The API reads the scene but does not write it.
- An image of an older state than the stored one is ignored (`kept: false`). Images may be up to 5 MiB.
- `GET …/reference` and the other routes answer `404` for whiteboards the caller cannot see.
- A version is kept when the last person leaves the board and after it was idle. Its `reason` is `session`, `restored` or `copied`.
