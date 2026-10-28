# Embeds, file previews, tabs and whiteboard blocks

These blocks are inserted with the slash menu or the **Insert** menu of the editor. The other blocks are listed in [Blocks](../blocks.md).

## External embeds

An embed shows a video, design, presentation or document of an external service inside the page.

1. Insert **External embed**.
2. Paste the share link into **Address** and give it a **Title**. The dialog says whether the service is on the embed allowlist.
3. Optionally set **Height in pixels**, from 100 to 2,000.
4. Choose **Insert embed**.

- An address on the allowlist appears as a frame. It loads only when it comes close to the visible part of the page, so opening a long page sends nothing to the services further down. The title and **Open at the source** stay below the frame, so readers can open the content at the source, also when the instance has no internet access and the frame stays empty.
- An address that is not on the allowlist appears as a link with a short hint. When an administrator adds the service later, the block shows the frame without editing the page; when a service is removed, its embeds turn back into links.
- Print and Word show the title and the link. An imported embed that came with a preview image also shows that image; Lunedo never fetches images from the service during an export.

The embedded service runs in its own origin and cannot reach the page, your session or other frames. Unless its rule says otherwise, the service learns nothing about the page that embeds it; the default YouTube rules send only the address of the instance, never the path of the page.

### The allowlist

Instance administrators decide which services can be embedded, and organization administrators can narrow that list for their organization. The default list allows YouTube (through the privacy-enhanced domain `youtube-nocookie.com`), Vimeo, Loom, Figma, Miro, Google Docs, Slides and Sheets, and Microsoft Stream and SharePoint. For SharePoint and Stream, paste the address from the embed code that SharePoint offers, not the share link.

How to manage the list is described in [External embeds](../../admin/embeds.md).

## File previews

**Show a preview in the page** on a file block shows the file inside the page: PDF, images, video, audio, text and code, Markdown, CSV, SVG (sanitized), Word and Excel. Other types stay a download link. PDF files are rendered by Lunedo, not by the browser.

- **Height in pixels** (150 to 2,000) and **Page size** (**Fit to width**, or 50 to 200 %) can be set.
- The file is loaded only when the block comes close to the visible part of the page.
- Readers who cannot open the file see nothing, not even its name.
- Print and Word show image files as a picture and other files as their name and link. PDF files appear as name and link.

## Tabs

A **Tabs** block holds up to 20 named tabs, each with its own content. A tab name has up to 100 characters. The first tab is shown by default.

- In the editor, the buttons above the content switch tabs. The active tab can be renamed, moved left or right and removed (with undo), and **Add tab** adds one. The last tab cannot be removed; delete the whole block instead.
- Readers switch with the mouse, or with the arrow keys, Home and End once a tab has focus.
- On phones the tabs become an accordion: every tab is a button that opens and closes its content.
- Print, Word and Markdown show all tabs one after another, each with its name as a heading.
- Search finds the names and the content of all tabs.

## Whiteboard blocks

**Link to whiteboard** shows the image and title of a [whiteboard](../whiteboards.md); clicking it opens the whiteboard. Choose the whiteboard in the block by its title.

The block resolves the whiteboard with the reader's permissions when the page is shown: readers who cannot open it see nothing, editors see "Restricted content" without the title. Print and Word show the image and the linked title by the same rule. The text of the whiteboard is searched on the whiteboard only, not on pages that show it.

Links in the page tree can point to whiteboards as well as to pages and folders.

## Numbered headings

**Number headings** in the page menu numbers the headings of the page (1, 1.1, 1.2 …) in the editor, the read view, print and Word. Numbers follow the nesting of the headings, so a level that is skipped does not leave a zero. The option is stored with the page; **Stop numbering headings** turns it off.
