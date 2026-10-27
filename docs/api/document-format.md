# Document format

The content of pages, blog posts, articles and templates is a document in ProseMirror JSON, defined by the editor schema. The web client, the API, imports and exports all use the same schema, so a document means the same everywhere. The full reference of the routes is at `/api/docs` on your instance.

## Reading and writing content

| Route | What it does | Permission |
|---|---|---|
| `GET /api/v1/pages/{pageId}/content` | The content readers see as JSON: the published version in publish mode, the current content in live mode | read the page |
| `GET /api/v1/pages/{pageId}/markdown` | The same content as GitHub-flavored Markdown | read the page |
| `PUT /api/v1/pages/{pageId}/content` | Replaces the content with `{ "document": … }` | edit the page |

- `GET …/content` returns `document`, `schemaVersion`, `revision` (it rises with every save), `updatedAt`, `updatedBy`, the `version` readers see and `references`: the names of mentioned people and the titles of linked pages, as far as the caller may see them.
- `PUT …/content` validates the document and merges it into the shared document of the page. People editing the page see the change at once. In publish mode it changes the draft; publish it with `POST /api/v1/pages/{pageId}/publish`.
- API tokens never open collaboration connections, the live editing channel of the web client. Scripts write through `PUT …/content`.

Articles of a knowledge base have their own routes, which also take Markdown; see [Knowledge base articles](knowledge-base-articles.md).

## Schema version

The schema has a version, `13` today. `GET …/content` returns it as `schemaVersion`, and template files carry it as `schemaVersion` (see [Template file format](template-format.md)).

- Lunedo migrates stored documents of older versions when it reads them, so `GET …/content` always returns the current version.
- `PUT …/content` expects a document of the current version. Read `schemaVersion` before writing and stop when it is newer than what your script knows.

## A minimal document

```json
{
  "type": "doc",
  "content": [
    {
      "type": "heading",
      "attrs": { "level": 2 },
      "content": [{ "type": "text", "text": "VPN access" }]
    },
    {
      "type": "paragraph",
      "content": [
        { "type": "text", "text": "Connect through " },
        { "type": "text", "marks": [{ "type": "bold" }], "text": "WireGuard" },
        { "type": "text", "text": "." }
      ]
    }
  ]
}
```

```sh
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"document\": $(cat document.json)}" \
  https://wiki.example.com/api/v1/pages/$PAGE/content
```

Attributes you leave out get their defaults.

## Nodes

Text and structure:

| Node | Content | Attributes |
|---|---|---|
| `doc` | blocks | |
| `paragraph` | inline | `textAlign` (`left`, `center`, `right`, `justify`), `indent` (0 to 8) |
| `heading` | inline | `level` (1 to 6), `textAlign`, `indent` |
| `text` | | the text, with marks; never empty |
| `hardBreak` | | |
| `blockquote` | blocks | |
| `horizontalRule` | | |
| `bulletList`, `orderedList` | `listItem` | `orderedList.start` (from 1) |
| `listItem` | paragraph, then blocks | |
| `taskList` | `taskItem` | |
| `taskItem` | paragraph, then blocks | `id` (task ID or null), `assignee` (account ID or null), `dueDate` (YYYY-MM-DD or null). Whether a task is done is not part of the document; read and set it with the task routes. |
| `codeBlock` | text without marks | `language` (a language of the highlighter or null) |
| `callout` | blocks | `variant` (`info`, `tip`, `note`, `warning`, `error`) |
| `expand` | blocks | `title` |
| `columns` | 2 to 4 `column` | |
| `column` | blocks | `width` in percent, 5 to 95; the columns of one row add up to 100 |
| `tabs` | 1 to 20 `tab` | |
| `tab` | blocks, but no further tabs | `title` (1 to 100 characters) |
| `table`, `tableRow` | rows, cells | |
| `tableCell`, `tableHeader` | blocks | `colspan`, `rowspan`, `colwidth` (one width per spanned column, or null), `background` (color name or null) |
| `section` | blocks | `key` (a semantic key such as `steps` or `resolution`), `title`, `icon` (name of a Lucide icon, or null) |
| `tableOfContents` | | `minLevel`, `maxLevel` (1 to 6) |

Inline nodes:

| Node | Attributes |
|---|---|
| `mention` | `id` (account ID) |
| `pageLink` | `pageId`, or `spaceId` and `title` for a page that does not exist yet |
| `date` | `date` (YYYY-MM-DD) |
| `emoji` | `emoji` (exactly one emoji) |
| `status` | `text` (1 to 40 characters), `color` (color name, default `gray`) |
| `inlineMath` | `latex` (up to 10,000 characters) |
| `placeholder` | `text`: an instruction for the author, 1 to 500 characters; readers of the page do not see it |
| `templateField` | `field`: the key of a template input field; replaced by its value when a page is created from the template |

Media, files and diagrams:

| Node | Attributes |
|---|---|
| `image` | `attachmentId`, `alt`, `width` (percent of the content width, 1 to 100, or null for the natural size), `align` (`left`, `center`, `right`), `frame` (true, false, or null for the default of the section) |
| `file` | `attachmentId`, `name`, `preview` (show the file inline), `height` (150 to 2,000 pixels or null), `zoom` (25 to 400 percent, or null to fit the width) |
| `attachmentList` | `fileTypes`: up to 20 file extensions without a dot, empty for all attachments of the page |
| `embed` | `url` (`http` or `https`), `title` (up to 255 characters), `height` (100 to 2,000 pixels or null), `thumbnailId` (an image stored with the block, or null) |
| `blockMath` | `latex` (up to 10,000 characters) |
| `drawio` | `id` (block ID), `sourceFormat` (`drawio`, or `gliffy` for an imported Gliffy file), `sourceId` and `sourceVersion` (attachment and version of the diagram file), `previewId` and `previewVersion` (attachment and version of the image), `text` (up to 20,000 characters, for search) |
| `drawioReference` | `id`, `pageId` and `diagramId` (the page and the `drawio` block whose current image it shows), `name` (up to 255 characters) |
| `mermaid`, `plantuml` | `id`, `source` (up to 50,000 characters), `previewId` and `previewVersion` (the SVG image), `text` |
| `drawing` | `id`, `sceneId` and `sceneVersion` (the scene), `previewId` and `previewVersion` (the SVG image), `text` |
| `whiteboard` | `whiteboardId` (or null until one is chosen) |

[Diagrams and whiteboards](diagrams-and-whiteboards.md) describes how to store diagram files and images.

Reports, listings and reuse:

| Node | Content | Attributes |
|---|---|---|
| `childPages` | | `pageId` (null for the page itself), `depth` (1 to 10, or null for all levels), `sort` (`tree`, `title`, `created`, `modified`), `reverse` |
| `pageReport` | | `spaceId` (null for every readable space), `labels` (up to 20), `sort` (`modified`, `created`, `title`), `reverse`, `limit` (1 to 100, default 20) |
| `taskReport` | | `spaceId`, `seriesId`, `pageIds` (up to 20), `labels`, `assignee` (account ID or null), `assignedToViewer` (not together with `assignee`), `due` (`any`, `overdue`, `next7Days`, `next30Days`, `none`), `status` (`open`, `done`, `all`) |
| `decisionReport` | | `spaceId`, `labels`, `parentId` (only decisions below this page, or null), `order` (`newest`, `oldest`) |
| `pageProperties` | `pageProperty` rows | `setId` (up to 100 characters or null), `hidden` |
| `pageProperty` | `pagePropertyKey`, then `pagePropertyValue` | |
| `pagePropertyKey` | text without marks, up to 200 characters | |
| `pagePropertyValue` | paragraphs, lists, quotes and code blocks | |
| `propertiesReport` | | `spaceIds`, `labels`, `setId`, `columns`, `firstColumn`, `sortBy` (a property name or null for the title), `reverse`, `pageSize` (1 to 100), `showCreator`, `showLabels`, `query` (an imported query that could not be converted) |
| `contentByLabel` | | `labels`, `matchAll`, `spaceIds`, `kinds` (`page`, `blogPost`), `sort`, `reverse`, `limit` (1 to 100), `excerpts`, `showLabels`, `showSpace`, `title`, `query` |
| `relatedLabels` | | `labels` (empty for the labels of the page), `title` |
| `excerpt` | blocks, but no excerpt | `name` (up to 100 characters or null), `hidden` |
| `includeExcerpt` | | `pageId`, or `sourceSpace` and `sourceTitle` of a Confluence page not imported yet; `name` of the excerpt, `panel` |
| `includePage` | | `pageId`, or `sourceSpace` and `sourceTitle` |
| `templateButton` | | `templateId` (a template ID or a built-in template), `label` (up to 100 characters), `title` (title pattern of the new page, up to 255 characters) |
| `roadmap` | | `roadmap`: `title`, `start` and `end`, `lanes` (up to 50, each with `title`, `color` and `bars`) and `markers`; up to 200 bars and ten years |

Meetings:

| Node | Content | Attributes |
|---|---|---|
| `topicUpdate` | blocks | `topicId`: the running topic this part of a meeting page updates |
| `decision` | paragraphs | `id` (decision ID or null), `topicId` (the topic it closes, or null) |

Imported content:

| Node | Attributes |
|---|---|
| `unsupportedMacro` | `name`, `data` (the original data, up to 256 KiB) |

[Blocks](../user/blocks.md) describes what each block does for readers and authors.

## Marks

`bold`, `italic`, `underline`, `strike`, `code`, `subscript`, `superscript`, `link` (`href`), `textColor` (`color`), `highlight` (`color`), `inlineComment` (`threadId`).

- Links allow `http`, `https` and `mailto` addresses and internal paths that start with a single `/`, up to 2,048 characters. `javascript:` and similar addresses are refused.
- Colors are names from a fixed palette: `gray`, `red`, `orange`, `yellow`, `green`, `teal`, `blue`, `purple`, `pink`.
- Subscript and superscript exclude each other. Inline code excludes all formatting marks except links.

## Validation and limits

Every stored document and every collaborative change is validated. A document is refused when it has unknown nodes, marks, attributes or fields, wrong attribute types, values outside their allowed set, invalid structure, marks where they are not allowed, empty text, or when it exceeds these limits:

| Limit | Value |
|---|---|
| Nesting depth | 40 |
| Serialized size | 2 MiB |
| Nodes | 50,000 |

A valid document is stored normalized: missing attributes get their defaults and marks are put in a fixed order.

## Unknown nodes and invalid documents

Unknown nodes, marks and attributes are never stored; they are refused, not dropped. A document that fails validation is refused with `400` and the problem `invalidDocument`. Its `problems` list names up to 50 problems, each with:

- `path`: the position in the document, such as `content.2.content.0`,
- `code`: the kind of problem, such as `unknownNode`, `unknownMark`, `unknownAttribute`, `missingAttribute`, `invalidAttribute`, `invalidContent`, `emptyText`, `tooDeep`, `tooLarge` or `tooManyNodes`,
- `message`: an explanation for people.

```json
{
  "type": "urn:lunedo:problem:invalidDocument",
  "title": "The document does not match the editor schema",
  "status": 400,
  "detail": "The document does not match the editor schema",
  "code": "invalidDocument",
  "problems": [
    { "path": "content.1.type", "code": "unknownNode", "message": "Unknown node chart" }
  ]
}
```

Programs that read documents should skip node types they do not know, because new nodes come with a new schema version.
