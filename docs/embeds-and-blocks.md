# Embeds, file previews, tabs and whiteboard blocks

These blocks are inserted with the slash menu or the Insert menu of the editor.

## External embeds

An embed shows a video, design, presentation or document of an external service inside the page.

- Insert **External embed**, paste the share link and give it a title. The dialog says whether the service is on the embed allowlist.
- An address on the allowlist appears as a frame. It loads only when it scrolls into view, so opening a long page sends nothing to the services further down. The title and the link stay below the frame, so readers can open the content at the source, also when the instance has no internet access and the frame stays empty.
- An address that is not on the allowlist appears as a link with a short hint. When an administrator adds the service later, the block shows the frame without editing the page; when a service is removed, its embeds turn back into links.
- The height can be set from 100 to 2,000 pixels.
- Print and Word show the title and the link. An imported embed that came with a preview image also shows that image; Pagehall never fetches images from the service during an export.

Frames run with `sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"`, `allow="fullscreen; picture-in-picture; encrypted-media"` and `referrerpolicy="no-referrer"`. The service runs in its own origin and cannot reach the page, the session or other frames.

### The allowlist

Instance administrators manage the list under **Settings › Instance › Rendering › External embeds allowlist**. Organization administrators can only narrow it, under **Settings › Organization › Pages and trash › External embeds allowlist**: they clear the services their organization should not embed. A narrowed list keeps its own value; **Allow all services of the instance** returns to the instance list. A service the instance adds later is not added to a narrowed list.

The default list allows YouTube (through the privacy-enhanced domain `youtube-nocookie.com`), Vimeo (with `dnt=1`), Loom, Figma, Miro, Google Docs, Slides and Sheets, and Microsoft Stream and SharePoint.

Each service has one or more rules. A rule has an **address pattern** for share links and an **embed address** built from it. Patterns are `https` addresses that end with a fixed domain; placeholders fill whole parts of the address:

| Placeholder | Stands for |
|---|---|
| `{name}` | one part: a label at the start of the host, one path segment or the value of a query parameter |
| `{*}` | any number of path segments, once per pattern |
| `{url}` | in the embed address only: the whole link, encoded |

Examples:

| Pattern | Embed address |
|---|---|
| `https://www.youtube.com/watch?v={video}` | `https://www.youtube-nocookie.com/embed/{video}` |
| `https://www.figma.com/design/{file}/{*}` | `https://www.figma.com/embed?embed_host=pagehall&url={url}` |
| `https://{tenant}.sharepoint.com/{*}/_layouts/15/embed.aspx?UniqueId={file}` | the same address |

Leaving the embed address empty embeds the link as it is. For SharePoint and Stream, paste the address from the embed code that SharePoint offers, not the share link. Captured values are decoded and encoded again for the embed address; values that are dot segments or contain slashes are refused, so a link cannot point the frame to another path of the service. Frame markup is never stored.

The web client sends `Content-Security-Policy: frame-src 'self' …` with the origins of all embed addresses of the instance list, so the browser refuses frames from any other origin even if a page contained one.

## File previews

The **File preview** option of a file block shows the file inside the page: PDF, images, video, audio, text and code, Markdown, CSV, SVG (sanitized), Word and Excel. Other types stay a download link. Previews use the same sandboxed frame as the preview drawer; PDF files are rendered by Pagehall, not by the browser.

- Height (150 to 2,000 pixels) and page size (fit to width or 50 to 200 percent) can be set.
- The file is loaded only when the block scrolls into view; large files are previewed up to the limits of the preview drawer.
- Readers who cannot open the file see nothing, not even its name.
- Print and Word show image files as a picture and other files as their name and link. PDF files have no stored preview image, so they appear as name and link.

## Tabs

A **Tabs** block holds up to 20 named tabs, each with its own content. The first tab is shown by default.

- In the editor, the buttons above the content switch tabs; the active tab can be renamed, moved, removed (with undo) and new tabs added.
- Readers switch with the mouse, or with the arrow keys, Home and End once a tab has focus. The block uses the `tablist`, `tab` and `tabpanel` roles.
- On phones the tabs become an accordion: every tab is a button that opens and closes its content.
- Print, Word and Markdown show all tabs one after another, each with its name as a heading.
- Search finds the names and the content of all tabs.

## Whiteboard blocks

**Link to whiteboard** shows the image and title of a whiteboard; clicking it opens the whiteboard. The block resolves the whiteboard with the reader's permissions when the page is shown: readers who cannot open it see nothing, editors see "Restricted content" without the title. Print and Word show the image and the linked title by the same rule. The text of the whiteboard is searched on the whiteboard only, not on pages that show it.

Links in the page tree can point to whiteboards as well as to pages and folders.

## Numbered headings

**Number headings** in the page menu numbers the headings of the page (1, 1.1, 1.2 …) in the editor, the read view, print and Word. Numbers follow the nesting of the headings, so a level that is skipped does not leave a zero. The option is stored with the page.
