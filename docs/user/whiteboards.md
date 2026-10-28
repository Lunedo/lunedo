# Whiteboards and drawings

Lunedo uses [Excalidraw](https://excalidraw.com) for hand-drawn sketches. A **whiteboard** is an item in the page tree with an infinite canvas that several people edit at the same time. A **drawing** is a block inside a page. draw.io, Mermaid and PlantUML diagrams are described in [Diagrams](blocks/diagrams.md).

Everything Excalidraw needs, including its fonts, is served by your Lunedo instance, so whiteboards and drawings work without internet access. Embedded web content is not available on whiteboards; add a link instead.

## Whiteboards

### Creating and organizing

Create a whiteboard with **+** in the page tree of a space and **New whiteboard**, or with **New whiteboard inside** in the menu of a page or folder.

Whiteboards are renamed, moved, archived, moved to the trash and restored like pages; see [Trash and archive](spaces-and-pages/trash-and-archive.md). A copy keeps its images and preview; see [Copying](spaces-and-pages/copying.md#copying). Whiteboards can be starred and watched. They cannot contain pages.

Access follows the space and the page tree, like pages: view restrictions of parent pages apply, a whiteboard can be restricted and shared with people outside the space, and people without access cannot open it, connect to it or see its image. See [Sharing and restrictions](sharing-and-restrictions.md).

A whiteboard has an address with its number, such as `/spaces/OPS/whiteboards/1042/network-plan`; see [Content addresses](spaces-and-pages/content-addresses.md#content-numbers-and-addresses).

### Drawing together

Editors and space admins draw directly on the canvas; everyone who can read the whiteboard sees it. Changes appear at once for everyone who has the whiteboard open, with their cursor, name and selection. The header shows who is on the whiteboard, with their profile pictures, and whether all changes are saved ("Saved"). Saving works as on pages; see [Editing together](collaboration.md).

- Shapes, arrows, lines, freehand, text, frames and images are available from the toolbar.
- **Sticky note** adds a note in the middle of the visible area. Notes are rectangles with text and can be colored and resized like other shapes.
- Images are stored as attachments of the whiteboard, with the size limit and storage checks of every upload.
- Links on elements can point to `http` and `https` addresses and to Lunedo pages. A change with any other link is not saved, and the whiteboard says so.
- A whiteboard holds up to 20,000 elements and 8 MiB.

On phones (narrower than 600 pixels), a whiteboard can be viewed and zoomed but not edited.

### Comments

Select one element and choose **Comment on element** to start a thread on it, or comment on the whole whiteboard. Threads on elements show what they refer to, for example "Sticky note: “Uplink to 10G?”"; choose **Show on the whiteboard** to jump to the element. When the element is removed, the thread stays and is marked as removed. Mentions notify the mentioned people as on pages.

### Versions

A version is kept when the last person leaves the whiteboard, and after it was not changed for the idle time set for live pages (**Version after a pause in live mode**, 10 minutes by default).

**Versions** in the whiteboard menu opens the version history at `/spaces/<key>/whiteboards/<number>/history`. It lists every version with its time and the people who changed it, shows its image and lets you choose **Explore this version**. **Restore version** with the number of the version, for example **Restore version 3**, makes it the current content at once for everyone and adds a new version; nothing in the history is lost.

### Images of whiteboards

After changes are saved, the browser of the person who made them stores an image of the whiteboard. Lunedo cleans the image before storing it. The image appears in the page tree (hover the icon), in folder overviews and in search results; each version keeps the image of its state. A whiteboard without an image shows a neutral icon.

### Search and notifications

Search finds the text of text elements, sticky notes and frame names, with the same visibility rules as pages. Choose **Whiteboard** under **Type** or write `type:whiteboard` to search only whiteboards. People who watch a whiteboard get one notification per version, never one per change; see [Notifications](notifications.md).

## Drawings in pages

Type `/drawing` or choose **Drawing** under **Insert** to add a drawing to a page. The editor opens in a large window; **Save drawing** stores the drawing and shows its image in the page. Choose **Edit** on the block to change it later. Closing with unsaved changes asks whether to discard them.

While someone edits a drawing, others see "Anna is editing this drawing" on the block and can keep editing the rest of the page.

The drawing and its image are stored as versions of the attachments `drawing-<block ID>.excalidraw` and `drawing-<block ID>.svg` of the page, so they follow the permissions, drafts and versions of the page: an older version of the page shows the drawing it had. Search finds the text of a drawing as part of the page. Exports and the print view use the image. Like a whiteboard, a drawing holds up to 20,000 elements and 8 MiB.

## Whiteboards in pages and the page tree

**Link to whiteboard** shows a whiteboard's image and title in a page and opens it on click, with the reader's permissions; links in the page tree can point to whiteboards. See [Whiteboard blocks](blocks/embeds-and-blocks.md#whiteboard-blocks).

Scripts can read and restore whiteboards through the API; see [Diagrams and whiteboards](../api/diagrams-and-whiteboards.md).
