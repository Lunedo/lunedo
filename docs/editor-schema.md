# Editor schema

`packages/editor-schema` defines the document model of pages. The web client, the API, the collaboration server, importers and exporters all use it, so a document means the same everywhere. It runs in Node and in the browser and contains no permission logic.

Documents are ProseMirror JSON. The server validates every stored document and every collaborative update with `validateDocument` and stores the normalized result.

## Nodes

| Node | Content | Attributes |
|---|---|---|
| `doc` | blocks | |
| `paragraph` | inline | `textAlign` (left, center, right, justify), `indent` (0 to 8) |
| `heading` | inline | `level` (1 to 6), `textAlign`, `indent` |
| `bulletList`, `orderedList` | `listItem` | `orderedList.start` (from 1) |
| `listItem` | paragraph, then blocks | |
| `taskList` | `taskItem` | |
| `taskItem` | paragraph, then blocks | `checked`, `assignee` (account ID or null), `dueDate` (YYYY-MM-DD or null) |
| `blockquote` | blocks | |
| `codeBlock` | text without marks | `language` (a language of the highlighter or null) |
| `callout` | blocks | `variant` (info, tip, note, warning, error) |
| `expand` | blocks | `title` |
| `columns` | 2 to 4 `column` | |
| `column` | blocks | `width` in percent, 5 to 95; the columns of one row add up to 100 |
| `horizontalRule` | | |
| `table`, `tableRow` | rows, cells | |
| `tableCell`, `tableHeader` | blocks | `colspan`, `rowspan`, `colwidth` (one width per spanned column or null), `background` (color name or null) |
| `inlineMath`, `blockMath` | | `latex` (up to 10,000 characters) |
| `tableOfContents` | | `maxLevel` (1 to 6) |
| `status` | | `text` (1 to 40 characters), `color` |
| `date` | | `date` (YYYY-MM-DD) |
| `mention` | | `id` (account ID) |
| `pageLink` | | `pageId`, or `spaceId` and `title` for a page that does not exist yet |
| `emoji` | | `emoji` (exactly one emoji) |
| `hardBreak` | | |
| `section` | blocks | `key` (a semantic key such as `resolution`), `title` |
| `unsupportedMacro` | | `name`, `data` (the original data, up to 256 KiB) |
| `image` | | `attachmentId`, `alt`, `width`, `align` |
| `file` | | `attachmentId`, `name` |
| `drawio` | | `id` (block ID), `sourceFormat` (`drawio`, or `gliffy` for an imported Gliffy file that draw.io converts on first edit), `sourceId` and `sourceVersion` (attachment version of the diagram file), `previewId` and `previewVersion` (attachment version of the image), `text` (up to 20,000 characters, for search) |
| `mermaid`, `plantuml` | | `id` (block ID), `source` (up to 50,000 characters), `previewId` and `previewVersion` (attachment version of the SVG image), `text` (up to 20,000 characters, for search) |
| `drawing` | | `id` (block ID), `sceneId` and `sceneVersion` (attachment version of the scene), `previewId` and `previewVersion` (attachment version of the SVG image), `text` (up to 20,000 characters, for search) |

## Marks

`bold`, `italic`, `underline`, `strike`, `code`, `subscript`, `superscript`, `link` (`href`), `textColor` (`color`), `highlight` (`color`), `inlineComment` (`threadId`).

Links allow `http`, `https` and `mailto` addresses and internal paths that start with a single `/`. Colors are names from a fixed palette (gray, red, orange, yellow, green, teal, blue, purple, pink); the web client maps them to design tokens for both themes. Subscript and superscript exclude each other; inline code excludes all formatting marks except links.

## Validation and limits

`validateDocument` rejects unknown nodes, marks, attributes and fields, wrong attribute types, values outside their allowed set, invalid structure, marks in places that do not allow them, empty text and documents above these limits:

| Limit | Value |
|---|---|
| Nesting depth | 40 |
| Serialized size | 2 MiB |
| Nodes | 50,000 |

On success it returns the normalized document: missing attributes are filled with their defaults and marks are in a canonical order.

## Rendering

`renderHtml` produces the HTML of the read view and `renderMarkdown` GitHub-flavored Markdown, both from the same module definitions. A render context resolves mentions, page links, attachments and dates and provides translated labels. The HTML renderer escapes all content, renders only allowed links and writes colors as names (`data-color`), never as values. Formulas render with KaTeX up to 20,000 characters of LaTeX per document; further formulas appear as their source. In Markdown, formulas stay inside code (`` $`…`$ `` and ```` ```math ```` blocks), so their content cannot turn into Markdown or HTML.

With `target: "print"` in the render context, `renderHtml` produces the HTML for print: images load at once with their width, and expand blocks show their content under their title. A node can define its own `print` form. A node that cannot be printed, such as a diagram without a preview, sets `print: "unsupported"` and appears as a note that names it and points to the page in Pagehall.

`renderWord` produces a neutral description of a Word document: paragraphs with styled text runs, headings with anchors, lists and task lists, tables with merged cells and backgrounds, code, labelled boxes for callouts and decisions, images, contents and placeholders. The server turns it into a `.docx` file; the package itself has no Word dependency. Each node defines a `word` form and each mark changes the style of its text. A node without a `word` form appears as the same note as in print. The render context's `nodeTitle` names nodes in that note.

## Whiteboard scenes

`@pagehall/editor-schema/scene` defines the scenes of whiteboards and drawing blocks: Excalidraw elements, images and settings. `validateScene` accepts the element types rectangle, diamond, ellipse, arrow, line, freedraw, text, image and frame with their known fields only; embedded web content, AI frames and custom data other than the sticky-note flag are refused. Links on elements allow `http`, `https` and internal paths. Images are referenced by the ID of an attachment of the same item, never by address.

| Limit | Value |
|---|---|
| Scene | 8 MiB |
| One element | 512 KiB |
| Elements | 20,000 |
| Images | 500 |
| Points of a line or stroke | 20,000 |
| Text of one element | 20,000 characters |

In Yjs, a scene is a map `elements` (element ID to element), a map `files` (file ID to attachment and type) and a map `settings`. Each client writes an element only when its version is newer; concurrent edits of one element are reconciled with Excalidraw's version and version nonce, so every client ends with the same scene. Deleted elements stay as tombstones for a day, so late changes from other people cannot bring them back.

## Collaboration

`@pagehall/editor-schema/yjs` converts between documents and Yjs documents in the format of Tiptap's collaboration extension (fragment `default`). `applyDocument` writes a document into an existing Yjs document with minimal changes, so edits made at the same time are kept.

## Versions and migrations

Every stored document records `editorSchemaVersion`. A change to the schema increases the version and adds a migration from the previous version to `migrations`; `migrateDocument` applies them in order. `src/fixtures/v<version>/` holds documents of every version, and the tests migrate and validate all of them, so a migration that breaks stored documents fails. Fixtures of a version are never changed once released.

## Adding a module

Macros and special blocks are modules. A module declares its nodes and marks with their attributes, content rules and its renderers for HTML, Word and Markdown:

```ts
export const pollModule = defineModule({
  name: "poll",
  nodes: [
    {
      name: "poll",
      spec: { group: "block", atom: true },
      attrs: { question: required(z.string().min(1)) },
      html: (node, renderer) => `<div class="ph-poll">${renderer.escape(attrOf<string>(node, "question"))}</div>`,
      word: (node) => [{ type: "paragraph", content: [wordText(attrOf<string>(node, "question"))] }],
      markdown: (node, renderer) => renderer.escape(attrOf<string>(node, "question")),
    },
  ],
});
```

Register it in `src/modules/index.ts`. The schema, validation and renderers are built from the registry, so nothing else in the package changes. Add fixtures that use every new node, mark and attribute, and increase the schema version when stored documents need a migration.
