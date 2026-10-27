# Diagrams: draw.io, Mermaid and PlantUML

Pages and blog posts can contain three kinds of diagram blocks besides [drawings](whiteboards.md#drawings-in-pages):

- **draw.io diagram**: network, flow, UML and other diagrams, edited in the [draw.io](https://www.drawio.com) editor (Apache-2.0).
- **Mermaid diagram**: a diagram written as text in [Mermaid](https://mermaid.js.org) syntax (MIT).
- **PlantUML diagram**: sequence, class and other UML diagrams written as text in [PlantUML](https://plantuml.com) syntax (MIT distribution).

Everything these blocks need is served by the instance. They work without internet access, and diagrams never leave the server.

## Using diagram blocks

### draw.io

Type `/draw.io` or choose **draw.io diagram** under **Insert**. The draw.io editor opens in a full-screen window; **Save and close** stores the diagram and shows its image in the page. Choose **Edit in draw.io** on the block to change it later, or **Cancel** to close without saving. Closing with unsaved changes asks first.

The block shows the version of the diagram file. While someone edits a diagram, others see "Anna is editing this diagram" on the block and can keep editing the rest of the page.

### Mermaid and PlantUML

Type `/mermaid` or `/plantuml`. The block opens with a small example. Write the source in the text field; the preview below follows while you type. **Save diagram** stores the source and the image; **Cancel** keeps the diagram as it was.

Mermaid diagrams use the classic look, the default theme and the dagre layout, so they keep their appearance when they are saved again. A diagram can choose another layout or look in its front matter, for example `layout: elk` under `config:`.

When the source has an error, the block keeps the last working preview and shows the error with the line it names. **Save diagram** stores nothing until the error is fixed.

While editing a page, **Preview** and **Source** on the block switch between the image and the source. In the read view, **Source** below the image shows the source.

### Where diagrams are stored

A diagram follows the permissions, drafts and versions of its page:

- The file of a draw.io diagram is stored as a version of the attachment `drawio-<block ID>.drawio`; Mermaid and PlantUML keep their source in the page itself.
- The image of every diagram is stored as a version of the attachment `<type>-<block ID>.svg`.
- An older version of the page shows the diagram it had. Attachment cleanup never removes a version that a page version, the current draft or a discarded draft still shows.
- People who cannot read the page cannot fetch the diagram file or its image.

Search finds the text inside diagrams: the labels of draw.io shapes and connectors and the text of Mermaid and PlantUML images, or their source while they have no image yet. The page, the print view, PDF, Word, HTML and Markdown exports show the stored image. A Mermaid or PlantUML diagram without an image appears with its source and a note.

### Diagrams of other pages

A page can show a draw.io diagram of another page. Such a block is read-only and always shows the diagram as readers of the other page currently see it, so a change there appears here the next time the page is opened. Its caption links to the other page, and **Edit on its page** opens that page for editing.

- People who cannot read the other page see "Restricted content" without the page title. Print, PDF, Word, HTML and Markdown leave such a block out.
- When the diagram was removed from the other page, the block says so.
- Search finds the diagram only on the page that holds it.
- The block keeps no file or image of its own, so moving, deleting or cleaning up the other page never leaves it with an outdated copy.

These blocks come from imported `inc-drawio` macros.

## Importing from Confluence

| Confluence macro | Becomes |
| --- | --- |
| `drawio` | draw.io block with the attached diagram file (`<name>` or `<name>.drawio`) and its preview (`<name>.png`) |
| `inc-drawio` | reference to the draw.io block of the other page, see [Diagrams of other pages](#diagrams-of-other-pages) |
| `gliffy` | draw.io block that shows the Gliffy preview and keeps the Gliffy file |
| draw.io app of Confluence Cloud: draw.io Diagram, draw.io Board | draw.io block with the attached diagram file and its preview, like `drawio`; boards are draw.io files too |
| draw.io app of Confluence Cloud: Embed draw.io Diagram | reference to the draw.io block of the other page, like `inc-drawio` |
| Gliffy app of Confluence Cloud | draw.io block that shows the Gliffy preview and keeps the Gliffy file, like `gliffy` |
| `mermaid`, `mermaid-macro`, `mermaid-diagram`, `mermaid-cloud` with the source in the macro body | Mermaid block with that source |
| `plantuml` | PlantUML block with its source |

Confluence Cloud stores the draw.io and Gliffy apps as app extensions (`ac:adf-extension`) whose key ends in `drawio`, `drawio-sketch`, `inc-drawio` or `gliffy`. Lunedo reads the diagram name and page from their parameters in any order and ignores the copy Confluence keeps as fallback. A diagram name with or without `.drawio` finds the same file and the same diagram of another page.

- An `inc-drawio` macro whose page is not part of the import shows a note with the diagram name; the report lists it under "included diagrams are on pages that were not imported".
- A draw.io diagram whose file is missing keeps its preview image. The import report lists it under "diagram files are missing"; editing it starts an empty diagram.
- Gliffy diagrams are converted to draw.io in the browser when someone first chooses **Edit in draw.io**; the report lists them. Until then, the page shows the Gliffy image. A server-side conversion would need the draw.io converter, which runs only in a browser.
- Mermaid macros whose source is stored in another form, such as compressed in a parameter, stay unsupported-macro blocks with their original data.
- Imported Mermaid and PlantUML diagrams have no image until someone saves them in Lunedo; until then, pages, search and exports use their source.

## Limits

| What | Limit | Why |
| --- | --- | --- |
| draw.io file | 10 MB | Diagrams with many embedded images reach a few MB; larger files make pages slow to open and edit. |
| draw.io image | 10 MB, 20,000 × 20,000 pixels | The image embeds the same pictures as the file. |
| Mermaid or PlantUML source | 50,000 characters | Larger sources are hard to read and slow to lay out. |
| Mermaid or PlantUML image | 2 MB, 20,000 × 20,000 pixels | Keeps pages, Word and PDF exports fast. |
| Mermaid or PlantUML rendering | 10 seconds | Stops sources that would never finish. |

The upload limit of the organization applies as for every attachment.

## Security

- Diagram images are sanitized on the server before they are stored: scripts, event handlers, links, external resources and unknown elements are removed. Labels of draw.io diagrams keep simple formatting. Mermaid and PlantUML images may not contain HTML. Images are served like other SVG files (`Content-Security-Policy: sandbox`, `X-Content-Type-Options: nosniff`) and shown as images, never inline.
- draw.io files are checked against the elements draw.io writes. Compressed pages are stored uncompressed, event handlers and links other than web, mail and page links are removed, and document type declarations are refused.
- The draw.io editor runs in a sandboxed frame without access to the session. It is served under `/drawio/<version>/` with a content security policy that allows connections only to the instance and no other frames, and it starts with cloud storage, plugins, update checks, sharing and telemetry switched off.
- Mermaid and PlantUML render in a hidden sandboxed frame (`/diagram.html`) without access to the session and without any network access. Mermaid runs with `securityLevel: "strict"`: no HTML labels, no click handlers, no scripts. PlantUML refuses `!include`, `!includeurl`, `!includesub`, `!import`, `!theme … from`, `%load_json`, `%getenv` and file functions before rendering; its standard library is not available.

## For administrators

### draw.io

Lunedo ships draw.io **31.4.6** unchanged, except for its configuration files, and serves it itself. The web build downloads the release archive from GitHub, checks its SHA-256 against the pinned value and leaves out the server parts, cloud connectors, plugins and source maps. The instance never contacts diagrams.net. Settings, Instance, Rendering shows the shipped version.

The icon sets and shape libraries of draw.io come with an additional condition from their authors: they may not be used in Atlassian products or the Atlassian Marketplace. Lunedo is neither; diagrams created with them are not affected.

### PlantUML rendering

PlantUML renders in the browser of the person who saves the diagram, with the official JavaScript build of PlantUML (`@plantuml/core`, MIT). The instance needs no Java, no Graphviz and no render service, and the optional [render container](rendering.md) is not involved. Exports, the print view and search use the stored image.

Without a browser that can run the renderer, for example in an export of a diagram that was imported and never saved, the block shows its source with a note instead of an image.

## API

| Request | Purpose |
|---|---|
| `PUT /api/v1/pages/{pageId}/diagrams/{blockId}/drawio` | Store the file of a draw.io diagram |
| `PUT /api/v1/pages/{pageId}/diagrams/{blockId}/image?type=drawio\|mermaid\|plantuml` | Store the image of a diagram |

Both need edit access to the page and answer with the attachment and version to point the block to, and the text of the diagram.
