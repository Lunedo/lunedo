# Spaces and pages

Content lives in spaces. A space belongs to one organization and holds a tree of pages, folders and links. Every standard space has an overview page, created together with the space. A space can also be created as a knowledge base, which holds articles in categories; see [knowledge-bases.md](knowledge-bases.md).

## Spaces

A space has a name, a description and a key of 2 to 10 letters or digits. The key appears in addresses such as `/spaces/ITOPS/pages/<page ID>/<title>`. Keys are unique regardless of case. When a space admin changes the key, addresses with the old key keep leading to the space until another space takes that key. Links to pages always work, because they contain the page ID.

Who can read a space:

| Visibility | Readers |
|---|---|
| `private` | Only the holders of a space role |
| `organization` | Every member of the organization, plus the holders. Collaborators and guests need a role. |
| `instance` | Every internal user of the instance, in all organizations, plus the holders |

Visibility grants reading only. Commenting, editing and managing always need a role.

### Roles

| Role | Allows |
|---|---|
| Reader | Read and export pages |
| Commenter | Also comment |
| Editor | Also create, edit and move pages, folders and links |
| Space admin | Also manage the settings and permissions of the space |

Roles are given to accounts, groups, all members of the organization or all internal users of the instance. A person's role is the highest of all roles that reach them, including the reader role through visibility. Only active accounts count.

Every change of visibility or permissions can be previewed first: `POST /api/v1/spaces/{spaceId}/visibility/preview` and `POST /api/v1/spaces/{spaceId}/permissions/preview` return who gains or loses access or gets another role. People the caller may not see are counted but not named.

Two rules protect a space from losing its administration:

- A change that would leave the space without an active space admin is refused (`lastSpaceAdmin`). Another space admin must be appointed first.
- Nobody can raise their own role, directly or through a group or a holder that includes them (`selfExtension`).

When the last space admin is deactivated, the space appears under **Organization settings → Spaces → Spaces without a space admin**, where an organization administrator appoints a new one. The appointment is recorded as `space.administratorAppointed`.

### Creating spaces

Members of an organization may create spaces unless the setting `spaces.membersCreateSpaces` (instance and organization, lockable, default on) is off. The creator always becomes space admin. New spaces start with the organization's default permissions, `spaces.defaultPermissions` (default: visibility `organization`, all members as editors); the creator sees them in the create dialog and can change them there. Changing the defaults never changes existing spaces.

## Personal spaces

Every active standard account can have one personal space, unless the instance setting `spaces.personalSpaces` (default on) is off. It is created when the person opens it for the first time (`POST /api/v1/account/personal-space`). Personal spaces are always private; the owner shares them by giving roles.

When the owner is deactivated, the personal space is listed for instance administrators under **Instance settings → Personal spaces**, without titles or content. Transferring it to another active standard account makes that account space admin, and is recorded as `space.personalTransferred`.

## The page tree

A tree item is a page, a folder or a link:

- **Pages** hold content written in the editor.
- **Folders** hold other items and show them as a list or as tiles, with an optional description. A folder can be turned into a page and back, without losing its children.
- **Links** point to an item in any space, or to a web address. A link to an item the reader cannot open shows "No access", without the item's title.

Items are ordered by a fractional position, so a move changes only the moved item. To duplicate an item instead, see [Copying](#copying). Moves lock the affected spaces, check that an item never ends up below itself, and reject a move whose neighbors changed in the meantime (`itemMoved`), so two people moving items at the same moment never break the tree. Moving an item to another space needs the editor role in both spaces; the move dialog shows first how access to the item changes.

Changes to the tree reach every open sidebar at once through the live updates stream.

In the sidebar, the page tree is operated with the keyboard: arrow keys move and open levels, Home and End jump to the first and last item, Shift+F10 opens the item's menu, and **Move…** in that menu moves an item without dragging. A move by drag and drop can be undone for 5 seconds.

## Copying

**Copy…** in the menu of a page, folder or whiteboard, in the page tree and on the item itself, creates a copy within the space or in another space of the same organization. A page can be copied alone or with the pages below it; a folder is always copied with its content.

- **Who can copy:** everyone who can read the item, into a space where they have the editor role. Copying out of a confidential space needs the editor role there as well, like moving.
- **What a copy contains:** the published version of each item (never a draft) as its first version, with "Copied from …" and a link to the original in its history for people who can read the original; everyone else sees "Copied from another page". The current version of every attachment comes along, including the files of drawings and diagrams; older attachment versions do not. Whiteboards keep their images and preview. Labels, page properties, page width, numbered headings and the page status (matched by name in another space) are copied; the person copying becomes the owner.
- **What stays behind:** comments, reactions, watchers, shares and share links, the version history and view or edit restrictions. Tasks are copied as new tasks with their assignees.
- **Links:** links between copied pages point to the copies; all other links, includes, excerpts and live diagram references keep pointing to their original targets.
- **Titles:** when the target space already has an item with the same title, the copy is called "Copy of …", then "Copy of … (2)" and so on.
- **Left out:** items below that the person cannot read, pages that were never published, meetings and meeting series. The dialog and the result say how many, never which.

A copy inherits the restrictions of its new place. Before copying, the dialog shows who can open the copy compared with the original. When people can open the copy who cannot open the original, the dialog says so and asks for an explicit confirmation; the copy is recorded as `page.copied` in the audit log, with the source, the target, the counts and whether the access was wider.

Copies of more than 20 items run in the background. The dialog shows their progress and can be closed; a notification arrives when the copy is done or failed. A copy reads the original at one point in time, so changes made while it runs are not half copied, and a copy that fails leaves nothing behind. While it runs, people keep editing and creating pages, also in the target space; moving or deleting the place the copy goes to takes priority, and the copy then starts again at the new place or fails because the place is gone. Attachments of a copy share the stored files of the original, so a copy takes almost no extra storage; when storage is almost full, copies with attachments are refused like uploads.

Through the API, `POST /api/v1/items/{itemId}/copy/preview` shows the access and the counts, `POST /api/v1/items/{itemId}/copy` copies, and `GET /api/v1/copies/{copyId}` returns the progress of a copy running in the background.

## Pages

Pages are edited together in real time; see [collaboration.md](collaboration.md) for connections, validation and saving, and [editor-schema.md](editor-schema.md) for the content format. Readers see a rendered view; people with the editor role switch to editing with **Edit** or the E key.

Pages have labels (up to 100 per page, listed per space under `/spaces/{key}/labels/{label}`) and backlinks: every page lists the readable pages that link to it.

Through the API, `GET /api/v1/pages/{pageId}/content` returns the content as JSON and `PUT` replaces it; `GET /api/v1/pages/{pageId}/markdown` returns it as GitHub-flavored Markdown. A `PUT` is validated against the editor schema and reaches open editors at once.

## Export

People export what they can read: pages in publish mode in their published version, with modules such as child page lists, reports, task lists and meeting details rendered as static content with their own permissions. Pages they cannot read are left out together with their titles and links. Private notes and history are not exported; open comments only in PDF and Word when asked for.

The export dialog in the page menu offers PDF, Word, HTML and Markdown, what to export (this page, the page with its subpages, or the whole space), whether attachments and comments are included, a table of contents, and the paper size (A4 or Letter) and orientation of PDF and Word. Readers export single pages; the page with its subpages and the whole space are shown to them as unavailable, with the reason. The space menu and the export page of the space settings offer the same choices for the whole space.

- A single page exports at once: as Markdown, as one HTML file with inline styles that opens offline, as a ZIP with both and the page's attachments, as print-ready HTML, as a Word document or, with the render container, as a PDF file (`GET /api/v1/pages/{pageId}/export?format=markdown|html|zip|print|docx|pdf`, with `attachments`, `comments`, `contents`, `paper` and `orientation` for the last three).
- **PDF through the browser.** The dialog opens a print view with the page laid out into sheets and calls the browser's print dialog, where people choose "Save as PDF". Pagehall adds the title block (space and path, title, author, published date and version), the table of contents with page numbers, page breaks between pages, the running header and the footer with "Page n of m"; the browser's own headers and footers should be turned off. For a page with subpages or a space, the print view is prepared on the server first, as a background export of the format `print`, and opens when it is ready. Browsers print up to 300 pages at once reliably; above that, the dialog offers Word, HTML or, when the render container is set up, PDF on the server. Chrome and Edge take the paper size and orientation from the print view; in Firefox and Safari, people choose the same paper size and orientation in the print dialog.
- **Word.** Word documents are created by Pagehall itself: headings, paragraphs, lists and task lists, tables with merged cells, code in a monospace style, callouts and decisions as framed boxes, images that the exporter may read embedded and other attachments as links, page links, mentions, status and dates as text, a table of contents that Word fills in when it updates the fields, and a header and footer with page numbers. Content that cannot be shown in a format appears as a note that names it.
- A space (`POST /api/v1/spaces/{spaceId}/exports`) or a page with its subpages (`POST /api/v1/pages/{pageId}/exports`) is built by a background job. Without a body, it is a ZIP: the page tree as folders, each page as Markdown and HTML, attachments next to their pages and an `index.html` with the tree. Links between exported pages become relative paths; other links point to the instance address. File names are safe on Windows, macOS and Linux and unique within their folder. With `format` (`html`, `markdown`, `print`, `pdf` or `docx`) and the same options as the dialog, it is a ZIP of one format or one document of all pages and published blog posts. `GET .../exports/summary` counts the pages first. Markdown files start with front matter (title, dates, labels and a `pagehall` block) so that a Markdown import can restore them. For public knowledge bases, `format: "site"` builds a static website; see [knowledge-bases.md](knowledge-bases.md#static-website).
- **Whiteboards** in a space or below an exported page are exported with the same permissions as pages; restricted whiteboards are left out. In PDF and Word each whiteboard is a page of its own with its title and its stored image; in the ZIP it has an HTML and a Markdown file that show the image, with the image as an SVG file next to them. A whiteboard without a stored image, for example one nobody has drawn on yet, shows a note instead; the image is stored after each change in the whiteboard. Word versions before 2016 show an empty frame in place of the image.
- When the file is complete, the person gets a notification. The download (`GET /api/v1/exports/{exportId}/content`) is kept for 7 days, or 24 hours after it was first downloaded completely, only for that person and only while they can still read what was exported. Each person runs one export at a time and keeps up to five; a new export of the same space or page in the same format replaces the earlier one. Exports are deleted when the person leaves the organization or is deactivated.
- If the worker stops while building, the job starts over; after three interrupted attempts the export fails with a reason and a notification. A download is never offered before the file is complete.
- Space admins turn export off in the space settings (`spaces.export`). It then applies to everyone, space and organization admins included, and the API answers with `exportDisabled`. Turning it off does not prevent copying content.
- PDF on the server needs the optional render container (see [rendering.md](rendering.md)). Without it, `format=pdf` answers with `renderUnavailable` and the message "Server-side PDF needs the render container; see the documentation"; people still create PDF files through their browser.

Space and subtree exports are recorded in the audit log as `space.exported` and `page.subtreeExported`, with their format.

## Audit

Creating spaces, changing their settings, keys, visibility and permissions, appointing space admins and transferring personal spaces are recorded in the audit log (`space.created`, `space.updated`, `space.permissionGranted`, `space.permissionChanged`, `space.permissionRemoved`, `space.administratorAppointed`, `space.personalTransferred`). Refused collaboration updates are recorded as `page.updateRejected`. See [audit.md](audit.md).
