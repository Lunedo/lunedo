# Editor schema

`packages/editor-schema` defines the document model of pages. The web client, the API, the collaboration server, importers and exporters all use it, so a document means the same everywhere. It runs in Node and in the browser and contains no permission logic.

Documents are ProseMirror JSON. The nodes, marks, attributes and limits that a stored document may contain are described in [document-format.md](../api/document-format.md). The server validates every stored document and every collaborative update with `validateDocument` and stores the normalized result. The web client builds its Tiptap extensions from the same module definitions (`apps/web/src/editor/schema`), and a test fails when the editor's schema differs from the shared one.

## Rendering

`renderHtml` produces the HTML of the read view and `renderMarkdown` GitHub-flavored Markdown, both from the same module definitions. A render context resolves mentions, page links, attachments and dates and provides translated labels. The HTML renderer escapes all content, renders only allowed links and writes colors as names (`data-color`), never as values. Formulas render with KaTeX up to 20,000 characters of LaTeX per document (`spendRenderBudget`); further formulas appear as their source. In Markdown, formulas stay inside code (`` $`…`$ `` and ```` ```math ```` blocks), so their content cannot turn into Markdown or HTML.

Headings are numbered when the render context has `numberHeadings` (a page option): numbers follow the nesting of the headings, counting section titles, in HTML, print, Word and Markdown.

With `target: "print"` in the render context, `renderHtml` produces the HTML for print: images load at once with their width, and expand blocks show their content under their title. A node can define its own `print` form. A node that cannot be printed, such as a diagram without a preview, sets `print: "unsupported"` and appears as a note that names it and points to the page in Lunedo.

`renderWord` produces a neutral description of a Word document: paragraphs with styled text runs, headings with anchors, lists and task lists, tables with merged cells and backgrounds, code, labelled boxes for callouts and decisions, images, contents and placeholders. The server turns it into a `.docx` file; the package itself has no Word dependency. A node defines a `word` form and a mark changes the style of its text. A node without a `word` form appears as the same note as in print. The render context's `nodeTitle` names nodes in that note.

## Whiteboard scenes

`@lunedo/editor-schema/scene` defines the scenes of whiteboards and drawing blocks: Excalidraw elements, images and settings. `validateScene` accepts the element types rectangle, diamond, ellipse, arrow, line, freedraw, text, image and frame with their known fields only; embedded web content, AI frames and custom data other than the sticky-note flag are refused. Links on elements allow `http`, `https` and internal paths. Images are referenced by the ID of an attachment of the same item, never by address.

| Limit | Value |
|---|---|
| Scene | 8 MiB |
| One element | 512 KiB |
| Elements | 20,000 |
| Images | 500 |
| Points of a line or stroke | 20,000 |
| Text of one element | 20,000 characters |

In Yjs, a scene is a map `elements` (element ID to element), a map `files` (file ID to attachment and type) and a map `settings`. Each client writes an element only when its version is newer than the stored one; concurrent edits of one element are reconciled with Excalidraw's version and version nonce, so every client ends with the same scene. Deleted elements stay in the map with `isDeleted`, so an older change from another client cannot bring them back.

## Reports and includes

Report blocks and include blocks hold only their settings. The renderers ask the render context for their data (`taskReport`, `pageReport`, `decisionReport`, `propertiesReport`, `contentByLabel`, `relatedLabels`, `childPages`, `attachmentList`, `include`), so every caller supplies only what the viewer may see. Without that data, the HTML renderer writes a placeholder with the settings as `data-` attributes, which the web client fills. Included content is rendered with `nested`, in the context of the included page, and contributes no text to the search index of the including page. When the viewer cannot read the included page, the renderer writes nothing in its place, or a note when the render context sets `showPlaceholders`.

## Collaboration

`@lunedo/editor-schema/yjs` converts between documents and Yjs documents in the format of Tiptap's collaboration extension (fragment `default`). `applyDocument` writes a document into an existing Yjs document with minimal changes, so edits made at the same time are kept. `migrateYDoc` brings a stored Yjs document to the current schema version when the collaboration server loads it.

## Versions and migrations

Every stored document records `editorSchemaVersion` (currently 13). A change to the schema increases the version and adds a migration from the previous version to `migrations` in `src/migrations.ts`; `migrateDocument` applies them in order. `src/fixtures/v<version>/` holds documents of every version, and the tests migrate and validate all of them, so a migration that breaks stored documents fails. Fixtures of a version are never changed once released.

## Adding a module

Macros and special blocks are modules. A module declares its nodes and marks with their attributes, content rules and renderers for HTML, Markdown and, optionally, Word and print:

```ts
export const pollModule = defineModule({
  name: "poll",
  nodes: [
    {
      name: "poll",
      spec: { group: "block", atom: true },
      attrs: { question: required(z.string().min(1)) },
      html: (node, renderer) => `<div class="ld-poll">${renderer.escape(attrOf<string>(node, "question"))}</div>`,
      word: (node) => [{ type: "paragraph", content: [wordText(attrOf<string>(node, "question"))] }],
      markdown: (node, renderer) => renderer.escape(attrOf<string>(node, "question")),
    },
  ],
});
```

Add it to `defaultModules` in `src/modules/index.ts`. The schema, validation and renderers are built from the registry, so nothing else in the package changes. A module can also bring importers that convert Confluence macros into its nodes.

A node or mark that holds the ID of an attachment or a page declares `copy`, which returns its attributes for a copy of the page: `copyAttachmentAttributes` maps attachment IDs (with their pinned version) to the copied attachments, `copyPageAttribute` maps references to pages that were copied along, and the link mark rewrites internal links in every address form through the mapping's `href`. A mark's `copy` can return `null` to drop the mark, as inline comments do. Nodes without `copy` keep their attributes, so references such as includes keep pointing to their original targets.

A node that refers to something outside the document declares `portable` as well, which returns its attributes for a template file, or removes what a file cannot carry, such as mentions, page links and reports.

Add fixtures that use every new node, mark and attribute, and increase the schema version when stored documents need a migration.
