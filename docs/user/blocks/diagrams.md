# Diagrams: draw.io, Mermaid and PlantUML

Pages and blog posts can contain three kinds of diagram blocks besides [drawings](../whiteboards.md#drawings-in-pages):

- **draw.io diagram**: network, flow, UML and other diagrams, edited in the [draw.io](https://www.drawio.com) editor.
- **Mermaid diagram**: a diagram written as text in [Mermaid](https://mermaid.js.org) syntax.
- **PlantUML diagram**: sequence, class and other UML diagrams written as text in [PlantUML](https://plantuml.com) syntax.

Everything these blocks need is served by your Lunedo instance. They work without internet access, and diagrams never leave the server. How the editors are shipped and secured is described in [Diagrams for administrators](../../admin/diagrams.md).

## Using diagram blocks

### draw.io

1. Type `/draw.io` or choose **draw.io diagram** under **Insert**. The draw.io editor opens in a large window.
2. Draw the diagram.
3. Choose **Save and close**. The diagram's image appears in the page.

Choose **Edit in draw.io** on the block to change it later, or **Cancel** to close without saving. Closing with unsaved changes asks first whether to discard them.

The block shows the version of the diagram file. While someone edits a diagram, others see "Anna is editing this diagram" on the block and can keep editing the rest of the page.

If draw.io does not start within 60 seconds, the window says "draw.io did not start" and offers to try again. If it does not hand over the diagram within 30 seconds after **Save and close**, wait a moment and choose **Save and close** again.

### Mermaid and PlantUML

1. Type `/mermaid` or `/plantuml`, or choose **Mermaid diagram** or **PlantUML diagram** under **Insert**. The block opens with a small example.
2. Write the source in the text field. The preview below follows while you type.
3. Choose **Save diagram**. The source and the image are stored.

Choose **Edit** on the block to change it later. **Cancel** keeps the diagram as it was; on a new block without an image, it removes the block.

When the source has an error, the block keeps the last working preview and shows the error, with the line when the renderer names one. **Save diagram** stores nothing until the error is fixed. Drawing that takes longer than 10 seconds is stopped.

**Preview** and **Source** on the block switch between the image and the source, also in the read view.

Mermaid diagrams use the classic look, the default theme and the dagre layout, so they keep their appearance when they are saved again. A diagram can choose another layout or look in its front matter, for example `layout: elk` under `config:`. HTML labels are turned off.

PlantUML renders in your browser. Its standard themes work. Including files or addresses is turned off: `!include` and its variants, `!import`, `!theme … from`, `%load_json`, `%getenv`, `%getallenv`, `%file_exists`, `%dirpath` and `%filename` are refused with a message. The PlantUML standard library is not available; copy what you need into the diagram.

### Where diagrams are stored

A diagram follows the permissions, drafts and versions of its page:

- The file of a draw.io diagram and the image of every diagram are stored as versions of attachments of the page, named after the block, such as `drawio-<block ID>.drawio` and `mermaid-<block ID>.svg`. Mermaid and PlantUML keep their source in the page itself.
- An older version of the page shows the diagram it had.
- People who cannot read the page cannot fetch the diagram file or its image.

Search finds the text inside diagrams: the labels of draw.io shapes and connectors and the text of Mermaid and PlantUML images, or their source while they have no image yet. The page, the print view, PDF, Word, HTML and Markdown exports show the stored image. A Mermaid or PlantUML diagram without an image, for example an imported one nobody has saved yet, appears with its source and a note.

### Diagrams of other pages

A page can show a draw.io diagram of another page. Such a block comes from an imported `inc-drawio` macro or an embedded draw.io diagram of Confluence Cloud. It is read-only and always shows the diagram as readers of the other page currently see it, so a change there appears here the next time the page is opened. Its caption links to the other page, and **Edit on its page** opens that page for editing.

- People who cannot read the other page see "Restricted content" without the page title. Print, PDF, Word, HTML and Markdown leave such a block out.
- When the diagram was removed from the other page, the block says so.
- Search finds the diagram only on the page that holds it.
- The block keeps no file or image of its own, so moving, deleting or cleaning up the other page never leaves it with an outdated copy.

How Confluence diagrams are imported is described in [What a Confluence import takes over](../../admin/imports/confluence-reference.md).

## Limits

| What | Limit | Why |
| --- | --- | --- |
| draw.io file | 4 MiB, 50,000 elements, 300,000 attributes, 1,000 pages | Larger files make pages slow to open and edit. |
| draw.io image | 10 MiB, 20,000 × 20,000 pixels | The image embeds the same pictures as the file. |
| Mermaid or PlantUML source | 50,000 characters | Larger sources are hard to read and slow to lay out. |
| Mermaid or PlantUML image | 2 MiB, 20,000 × 20,000 pixels | Keeps pages, Word and PDF exports fast. |
| Mermaid or PlantUML rendering | 10 seconds | Stops sources that would never finish. |

Scripts can store diagrams through the API; see [Diagrams and whiteboards](../../api/diagrams-and-whiteboards.md).
