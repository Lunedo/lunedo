# Export

People export what they can read as PDF, Word, HTML or Markdown: a single page, a page with its subpages, or a whole space.

## What an export contains

- Pages in publish mode are exported in their published version. A page that was never published cannot be exported: "Exports contain only published content. Publish the page first, then export it."
- Blocks such as child page lists, reports, task lists and meeting details are rendered as static content, with the permissions of the person who exports.
- Pages you cannot read are left out, together with their titles and the links to them.
- Private notes and the history are never exported. Open comments are exported only in PDF and Word, and only with **Include comments**.
- Whiteboards in a space or below an exported page are exported with the same permissions as pages. In PDF and Word each whiteboard is a page of its own with its title and its stored image; in HTML and Markdown it has a file that shows the image, with the image as an SVG file next to it. A whiteboard without a stored image, for example one nobody has drawn on yet, shows a note instead. Word versions before 2016 show an empty frame in place of the image.
- Content that cannot be shown in a format appears as a note that names it.

## Exporting

1. Choose **Export…** in the page menu, or **Export space** in the space menu.
2. Choose the **Format**: **PDF**, **Word**, **HTML** or **Markdown**.
3. Choose **What to export**: **This page**, **This page and its subpages**, or **The whole space**.
4. Under **More options**, choose whether to **Include attachments**. For PDF and Word, also choose **Include comments**, **Table of contents**, the **Page size** (A4 or Letter) and the **Orientation**. In PDF and Word, images stay in the document and other attachments are listed in an appendix.
5. Choose **Download** for a single page, or **Start export** for several pages. For PDF, the button is **Open print view** for a single page and **Prepare print view** for several pages.

Anyone who can read a page can export it alone. Exporting several pages at once, a page with its subpages or the whole space, is for space admins, and for organization administrators who manage spaces and have a role in the space, unless the space is confidential. Others see these choices as unavailable, with the reason.

### Single pages

A single page exports at once:

- **Markdown**, or **HTML** as one file with inline styles that opens offline. With **Include attachments**, you get a ZIP file with the page as Markdown and HTML and its attachments.
- **Word**, as a `.docx` file.
- **PDF** through the browser's print dialog; see [PDF](#pdf).

### Several pages

A page with its subpages or a whole space is built in the background. You get a notification with the download when the file is ready, and the export appears under **Settings › My account › My exports**.

- **HTML** and **Markdown** give a ZIP file with the page tree as folders and the attachments next to their pages. Links between exported pages become relative paths; other links point to the instance address. File names are safe on Windows, macOS and Linux and unique within their folder.
- **Word** and **PDF** give one document with all pages and, for a whole space, its published blog posts.
- Markdown files start with front matter (title, dates, labels and a `lunedo` block), so that a [Markdown import](../admin/imports/markdown.md) can restore them.
- Before you start, the dialog counts the pages you can read.

For public knowledge bases, a whole knowledge base can also be downloaded as a static website; see [Static website](knowledge-bases/knowledge-base-static-website.md).

## PDF

**Through the browser.** The dialog opens a print view with the page laid out into sheets and calls the browser's print dialog; choose its option to save as PDF there. Lunedo adds the title block (space and path, title, author, published date and version), the table of contents with page numbers, page breaks between pages, the running header and the footer with "Page n of m". Turn off the browser's own headers and footers. For a page with subpages or a space, the print view is prepared on the server first and opens when it is ready. Chrome and Edge take the page size and orientation from the print view; in Firefox and Safari, choose the same paper size and orientation in the print dialog.

**On the server.** When an export has more pages than browsers print reliably and the [render container](../admin/rendering.md) is set up, the dialog offers **Create PDF on the server**, which creates the PDF file without the browser. Without the render container, PDF on the server is refused with "PDF on the server needs the render container, which is not set up or not reachable"; the browser's print dialog still works.

## Word

Lunedo creates Word documents itself. They contain headings, paragraphs, lists and task lists, tables with merged cells, code in a monospace style, callouts and decisions as framed boxes, images you may read embedded and other attachments as links, page links, mentions, status and dates as text, a table of contents that Word fills in when it updates the fields, and a header and footer with page numbers.

## Limits

| What | Limit |
|---|---|
| Pages in the browser's print view | 300. Above that, the dialog offers Word, HTML or, with the render container, PDF on the server. |
| Pages in one Word or PDF file | 1000. Above that, export as an HTML or Markdown archive, or a smaller part. |
| Exports running at the same time | One per person |
| Exports kept | Five per person. Delete one you no longer need first. |
| Download kept | 24 hours after you first downloaded it completely, or 7 days if you never download it |

A new export of the same space or page in the same format replaces the earlier one. Only you can open your downloads, and only while you can still read what was exported. Your exports are deleted when you leave the organization or your account is deactivated. When the storage of the instance is almost full, exports of several pages are paused; exporting a single page still works.

If the server stops while building an export, the export starts over. After three interrupted attempts it fails with a reason and a notification. A download is never offered before the file is complete.

## Turning export off for a space

Space admins turn export off under **Export** in the space settings. It then applies to everyone, space and organization administrators included: "Export is turned off for this space". Turning export off does not prevent copying; people who can read a page can still copy its content.

Exports of a space or a page with its subpages are recorded in the audit log. Exports can also be started through the API; see [Spaces and pages in the API](../api/spaces-and-pages.md).
