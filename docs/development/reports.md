# Reports and reusable content

How the page properties report, content by label and related labels get their data. What the blocks do for people is described in [user/reports-and-reuse.md](../user/blocks/reports-and-reuse.md).

## Where the values come from

Reports never read page documents when they are shown. They read two tables that are written whenever the content readers see changes:

- `page_properties`: one row per property of a **Page properties** block.
- `page_excerpts`: the plain text of the first excerpt of a page, for **Content by label**.

Both are written by `syncReusableContent` in `packages/server/src/spaces/properties.ts`. It runs inside `readerContentChanged` (`packages/server/src/collaboration/content.ts`), which is called in the same transaction when a page is created, published, saved in live mode, switched between publish and live mode or created as a copy, and by the import pipeline (`packages/server/src/imports/pipeline.ts`). Drafts never reach the tables, so a report always shows the published state. The function deletes the rows of the item and writes them again from the document; there is no partial update.

## The `page_properties` table

`extractPageProperties` in `packages/editor-schema/src/modules/properties.ts` walks the document and returns one entry per row of every `pageProperties` node:

| Column | Content |
|---|---|
| `item_id` | The page or blog post |
| `block` | Index of the `pageProperties` node in the document, counted from 0 |
| `position` | Row within that block |
| `set_id` | The **ID** of the block, or null |
| `key` | The property name as written, 1 to 200 characters |
| `key_normalized` | The name in lower case; reports compare names through it |
| `value` | The cell content as editor JSON, so reports render it with links, mentions and status |
| `text` | Plain text of the value, whitespace collapsed, at most 2000 characters |
| `sort_key` | `text` in lower case with every number padded to 20 digits, at most 400 characters, so numbers sort by value |

The primary key is `(item_id, block, position)`; the index on `(key_normalized, item_id)` serves the name filter. Rows with an empty name and a second row with the same normalized name in one block are skipped. Rows are removed with their tree item.

`page_excerpts` holds one row per item with the first 500 characters of the plain text of its first excerpt.

## Queries

`ReportService` in `packages/server/src/spaces/reports.ts` builds every report as one SQL query:

- The candidate items are `tree_items` filtered by the visibility filter of the authorization service (`visibleItem`), the chosen spaces and labels. Archived items are left out unless the request names spaces, in which case items of archived spaces stay.
- The page properties report keeps items with at least one row in `page_properties` (of the requested `set_id`, when given), sorts by the `sort_key` of the first matching row with nulls last, then by title, and pages with `limit` and `offset` (at most 100 per page).
- Without requested columns, the report offers the names used on the matching items, ordered by their first position and then by frequency, up to 50; at most 30 become columns.
- Content by label joins `page_excerpts` and `blog_posts` only when excerpts are requested; a blog post without an excerpt block uses the excerpt of the post itself. It returns at most 100 entries.
- Related labels counts the readable pages that share a label and returns up to 30 labels.

The block limits (`MAX_PROPERTIES_REPORT_COLUMNS`, `MAX_PROPERTIES_REPORT_PAGE_SIZE`, `MAX_CONTENT_BY_LABEL_LIMIT`, `MAX_FILTER_SPACES`, `MAX_FILTER_LABELS`) live in the editor schema, so the editor, the importer and the server use the same values.

## Routes

The web client and scripts use the public routes `GET /api/v1/reports/properties`, `GET /api/v1/reports/content-by-label`, `GET /api/v1/reports/pages`, `GET /api/v1/reports/decisions` and `GET /api/v1/pages/{pageId}/related-labels` in `apps/api/src/collaboration/reports.controller.ts`. Print, Word and PDF exports call the same service with the permissions of the person who exports.
