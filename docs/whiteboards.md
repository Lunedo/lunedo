# Whiteboards and drawings

Pagehall uses [Excalidraw](https://excalidraw.com) (MIT) for hand-drawn sketches. draw.io, Mermaid and PlantUML diagrams are described in [diagrams.md](diagrams.md). A **whiteboard** is an item in the page tree with an infinite canvas that several people edit at the same time. A **drawing** is a block inside a page.

Everything Excalidraw needs, including its fonts, is served by the instance. Whiteboards and drawings work without internet access and never contact excalidraw.com: the library browser, collaboration links, embedded web content and AI features are switched off.

## Whiteboards

### Creating and organizing

Create a whiteboard with **+** in the page tree of a space, or with **New whiteboard inside** in the menu of a page or folder. Whiteboards are renamed, moved, archived, moved to the trash and restored like pages. They can be starred and watched. Whiteboards cannot contain pages.

Access follows the space and the page tree, like pages: view restrictions of parent pages apply, a whiteboard can be restricted and shared with people outside the space, and people without access cannot open it, connect to it or see its image.

### Drawing together

Editors and space admins draw directly on the canvas; everyone who can read the whiteboard sees it. Changes appear at once for everyone who has the whiteboard open, with their cursor, name and selection. The header shows who is on the whiteboard and whether all changes are saved ("Saved").

- Shapes, arrows, lines, freehand, text, frames and images are available from the toolbar.
- **Sticky note** adds a note in the middle of the visible area. Notes are rectangles with text and can be colored and resized like other shapes.
- Images are stored as attachments of the whiteboard, with the size limit and storage checks of every upload.
- Links on elements can point to `http` and `https` addresses and to Pagehall pages.

On phones (narrower than 600 pixels), a whiteboard can be viewed and zoomed but not edited.

### Comments

Select one element and choose **Comment on element** to start a thread on it, or comment on the whole whiteboard. Threads on elements show what they refer to, for example "Sticky note: “Uplink auf 10G?”"; select the quote to jump to the element. When the element is removed, the thread stays and is marked "Element removed". Mentions notify the mentioned people as on pages.

### Versions

A version is kept when the last person leaves the whiteboard and after it was not changed for the idle time set for live pages (**Version after a pause in live mode**, 10 minutes by default). The **Version history** lists every version with its time and the people who changed it, shows its image and lets you explore it. **Restore version** makes it the current content at once for everyone and adds a new version; nothing in the history is lost.

### Images of whiteboards

After changes are saved, the browser of the person who made them stores an SVG image of the whiteboard. Pagehall sanitizes the image before storing it and serves it like other SVG files (`Content-Security-Policy: sandbox`, `X-Content-Type-Options: nosniff`). The image appears in the page tree (hover the icon), in folder overviews and in search results; each version keeps the image of its state. A whiteboard without an image shows a neutral icon.

### Search and notifications

Search finds the text of text elements, sticky notes and frame names, with the same visibility rules as pages. Choose **Whiteboards** under **Type** or write `type:whiteboard` to search only whiteboards. People who watch a whiteboard get one notification per version, never one per change.

## Drawings in pages

Type `/drawing` or choose **Drawing** under **Insert** to add a drawing to a page. The editor opens in a large window; **Save drawing** stores the drawing and shows its image in the page. Choose **Edit** on the block to change it later.

While someone edits a drawing, others see "Anna is editing this drawing" on the block and can keep editing the rest of the page.

The drawing and its image are stored as versions of the attachments `drawing-<block ID>.excalidraw` and `drawing-<block ID>.svg` of the page, so they follow the permissions, drafts and versions of the page: an older version of the page shows the drawing it had. Search finds the text of a drawing as part of the page. Exports and the print view use the image.

## API

| Request | Purpose |
|---|---|
| `POST /api/v1/spaces/{spaceId}/items` with `kind: "whiteboard"` | Create a whiteboard |
| `GET /api/v1/whiteboards/{itemId}/scene` | Current scene |
| `GET /api/v1/whiteboards/{itemId}/preview` | SVG image, optionally of a `version` |
| `PUT /api/v1/whiteboards/{itemId}/preview?revision=` | Store the image of a saved state |
| `GET /api/v1/whiteboards/{itemId}/versions`, `…/versions/{number}` | Versions |
| `POST /api/v1/whiteboards/{itemId}/versions/{number}/restore` | Restore a version |
| `PUT /api/v1/pages/{pageId}/drawings/{blockId}/scene`, `…/preview` | Store the scene and image of a drawing block |

Real-time editing uses the collaboration server with the document name `whiteboard:<item ID>`; see [collaboration.md](collaboration.md).
