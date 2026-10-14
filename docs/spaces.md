# Spaces and pages

Content lives in spaces. A space belongs to one organization and holds a tree of pages, folders and links. Every space has an overview page, created together with the space.

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

Items are ordered by a fractional position, so a move changes only the moved item. Moves lock the affected spaces, check that an item never ends up below itself, and reject a move whose neighbors changed in the meantime (`itemMoved`), so two people moving items at the same moment never break the tree. Moving an item to another space needs the editor role in both spaces; the move dialog shows first how access to the item changes.

Changes to the tree reach every open sidebar at once through the live updates stream.

In the sidebar, the page tree is operated with the keyboard: arrow keys move and open levels, Home and End jump to the first and last item, Shift+F10 opens the item's menu, and **Move…** in that menu moves an item without dragging. A move by drag and drop can be undone for 5 seconds.

## Pages

Pages are edited together in real time; see [collaboration.md](collaboration.md) for connections, validation and saving, and [editor-schema.md](editor-schema.md) for the content format. Readers see a rendered view; people with the editor role switch to editing with **Edit** or the E key.

Pages have labels (up to 100 per page, listed per space under `/spaces/{key}/labels/{label}`) and backlinks: every page lists the readable pages that link to it.

Through the API, `GET /api/v1/pages/{pageId}/content` returns the content as JSON and `PUT` replaces it; `GET /api/v1/pages/{pageId}/markdown` returns it as GitHub-flavored Markdown. A `PUT` is validated against the editor schema and reaches open editors at once.

## Export

People export what they can read: pages in publish mode in their published version, with modules such as child page lists, reports, task lists and meeting details rendered as static content with their own permissions. Pages they cannot read are left out together with their titles and links. Comments, private notes and history are not exported.

- A single page exports at once as Markdown, as one HTML file with inline styles that opens offline, or as a ZIP with both and the page's attachments (`GET /api/v1/pages/{pageId}/export?format=markdown|html|zip`).
- A space (`POST /api/v1/spaces/{spaceId}/exports`) or a page with its subpages (`POST /api/v1/pages/{pageId}/exports`) is built by a background job into a ZIP: the page tree as folders, each page as Markdown and HTML, attachments next to their pages and an `index.html` with the tree. Links between exported pages become relative paths; other links point to the instance address. File names are safe on Windows, macOS and Linux and unique within their folder.
- When the archive is complete, the person gets a notification. The download (`GET /api/v1/exports/{exportId}/content`) is kept for 7 days, only for that person and only while they can still read what was exported. Each person runs one export at a time and keeps up to five; a new export of the same space or page replaces the earlier one. Exports are deleted when the person leaves the organization or is deactivated.
- If the worker stops while building, the job starts over; after three interrupted attempts the export fails with a reason and a notification. A download is never offered before the archive is complete.
- Space admins turn export off in the space settings (`spaces.export`). It then applies to everyone, space and organization admins included, and the API answers with `exportDisabled`. Turning it off does not prevent copying content.

Space and subtree exports are recorded in the audit log as `space.exported` and `page.subtreeExported`.

## Audit

Creating spaces, changing their settings, keys, visibility and permissions, appointing space admins and transferring personal spaces are recorded in the audit log (`space.created`, `space.updated`, `space.permissionGranted`, `space.permissionChanged`, `space.permissionRemoved`, `space.administratorAppointed`, `space.personalTransferred`). Refused collaboration updates are recorded as `page.updateRejected`. See [audit.md](audit.md).
