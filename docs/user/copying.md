# Copying pages, folders and whiteboards

A copy duplicates a page, a folder or a whiteboard, within its space or into another space of the same organization. To move an item instead, see [Moving items](spaces-and-pages.md#moving-items).

## Copying

1. Choose **Copy…** in the menu of a page, folder or whiteboard, in the page tree or on the item itself.
2. Choose the **Space**, the place below (**Place below**) and the **Position**.
3. For a page with subpages, choose whether to **Copy the pages below as well**. A folder is always copied with its content.
4. Check **What is copied** and **Who can open the copy**.
5. Choose **Create copy**, or **Copy to …** for another space.

### Who can copy

Everyone who can read the item can copy it into a space where they have the editor role. Copying out of a confidential space into another space needs the editor role in the confidential space as well.

### What a copy contains

- The published version of each item, never a draft, as its first version. Its history says "Copied from …" with a link to the original for people who can read the original; everyone else sees "Copied from another page".
- The current version of every attachment, including the files of drawings and diagrams. Older attachment versions stay behind.
- Whiteboards keep their images and preview.
- Labels, page properties, the page width, numbered headings and the page status. In another space, the status is matched by its name.
- Tasks, as new tasks with their assignees.
- The person copying becomes the owner of every copy.

### What stays behind

Comments, reactions, watchers, shares and share links, the version history, and view or edit restrictions are not copied.

Some items below are left out: items you cannot open, pages that were never published, meetings and meeting series. The dialog and the result say how many, never which.

### Links in the copy

Links between copied items point to the copies. This holds for every form in which content links to an item of the instance: addresses with or without the short form, relative addresses such as `/spaces/ITOPS/pages/1040/network-plan` and full addresses with the instance address. Each rewritten link gets the current address of the copy in its new space and keeps its anchor, so a link to `#rollback` still jumps to that heading in the copy.

All other links, includes, excerpts and live diagram references keep pointing to their original targets.

### Titles

When the target space already has an item you can see with the same title, ignoring case, the copy is called "Copy of …", then "Copy of … (2)" and so on. The prefix follows your language, for example "Kopie von …" in German.

### Who can open the copy

A copy takes the access rules of its new place; restrictions of the original are not copied. Before copying, the dialog shows who can open the copy compared with the original. When people can open the copy who cannot open the original, the dialog says "More people can read the copy than the original", and you must confirm **I want these people to be able to open the copy**. Every copy is recorded in the audit log, including whether more people can open it than the original; see [Audit log](../admin/audit-log.md).

### Large copies

Copies of more than 20 items run in the background. The dialog shows their progress and can be closed; a notification arrives when the copy is done or has failed.

- A copy reads the original at one point in time, so changes made while it runs are not half copied.
- A copy that fails leaves nothing behind.
- While it runs, people keep editing and creating pages, also in the target space. When someone moves or deletes the place the copy goes to, the copy starts again at the new place, or fails because the place is gone.

Attachments of a copy share the stored files of the original, so a copy takes almost no extra storage. When the storage is almost full, copies are stopped like uploads.

Copies can also be made through the API; see [Spaces and pages in the API](../api/spaces-and-pages.md).
