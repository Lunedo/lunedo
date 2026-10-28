# Page properties, label reports and reusable content

These blocks collect information from many pages and reuse content in several places. They are inserted with `/` in the editor or come from a Confluence import. The other report blocks (Page report, Decision report, Task report, Child pages, Attachment list) are described in [Blocks](../blocks.md#reports-and-lists).

Every block shows only what the viewer may read. Pages that are restricted for the viewer, in the trash or not published yet are never listed, counted or used for sorting, and their titles never appear. Archived pages are left out too, except in a block that is limited to spaces that are archived as a whole.

## Page properties

**Page properties** is a table of names and values, for example the owner, the uplink and the status of a site. Values can contain text, links, mentions, dates, status, lists, quotes and code. Add a row with **Add property**; **Enter** in a name moves to its value, **Tab** and **Shift+Tab** move between the cells.

- **ID** separates several sets of page properties on one page. A page properties report can show only the sets with a given ID.
- **Hide on the page** hides the table from readers of the page. Reports still show its values. Editors see a dashed frame in the editor.

Only the published version of a page counts, or the saved state of a page in live mode. While a page has an unpublished draft, reports show the values of the published version. A page that was never published is not listed. See [Publishing and page status](../spaces-and-pages/publishing-and-page-status.md).

| What | Limit |
|---|---|
| Property name | 1 to 200 characters |
| ID | up to 100 characters |

## Page properties report

**Page properties report** lists pages that have page properties, with one column per property name:

- **Spaces** and **Labels** choose the pages: pages in one of the spaces (every space you can read when empty) with at least one of the labels. A block takes up to 20 spaces and 20 labels.
- **Columns** are the names of the properties to show, in this order, up to 30. Names are compared without case. Without columns, the report shows the names used on the listed pages.
- **Order** sorts by title or by the value of a property. Numbers in values are sorted by their value, dates in the order of the calendar. Pages without that property come last. Readers can sort by any column by selecting its heading; this does not change the block.
- **Pages per page** sets how many pages are shown at once, 30 by default and at most 100; the report pages through the rest.
- **Page properties ID** shows only the sets of page properties with this ID. Leave it empty for all.
- **Heading of the first column**, **Show who created each page** and **Show the labels of each page** change what the table shows.

The report is always up to date: it reads the values when it is shown. In print and Word exports, it shows the first page of results with the permissions of the person who exports.

## Content by label

**Content by label** lists pages and blog posts with labels:

- **Pages must have** offers **Any of the labels** or **All of the labels**.
- The list can be limited to some spaces, and under **Kinds of content** to pages or to blog posts.
- It is sorted by last change, creation or title and shows 5 entries by default, up to 100.
- **Show the space** and **Show the labels** are on by default. **Show excerpts** adds the excerpt of each entry: the first excerpt block of a page, or the excerpt of a blog post.
- **Heading** is shown above the list.

## Related labels

**Related labels** shows labels that are used on the same pages as the labels of the current page, or as the labels chosen in the block, most used first, up to 30. Only pages you can read count. Each label links to the pages with that label in the space.

## Excerpts and includes

An **Excerpt** marks part of a page for reuse. It can have a name of up to 100 characters, so a page can have several excerpts. With **Hide on this page**, readers of that page do not see it, but it appears where it is included.

**Include excerpt** shows the excerpt of another page: the first one, or the one named under **Excerpt name**. **Show the title of the page above the excerpt** is on unless you switch it off. **Include page** shows the published content of another page.

- Included content is shown with the permissions of the viewer, when it is shown. A reader who cannot read the included page sees nothing at all. Editors of the including page see "Restricted content" without the title.
- A page that would include itself, also through other pages, shows a message instead. Includes are followed up to three levels deep.
- Search finds included content only on the page it comes from, not on the pages that include it.
- Print and Word exports render included content the same way, with the permissions of the person who exports. Content from a space where exports are switched off is left out.

## Blocks from a Confluence import

A page properties report or content by label list whose Confluence query uses filters that Lunedo cannot apply keeps the original query. In the editor, the block then shows "Filter from Confluence not taken over" with the query, so that an editor can check the labels and spaces. See [what a Confluence import takes over](../../admin/imports/confluence-reference.md).

## Roadmaps

Roadmaps from the Confluence Roadmap Planner are imported as read-only timelines with their lanes, bars, markers and months. The title and description of a bar appear when you point at it, and a bar linked to a page opens that page if you can read it. **Show as list** lists the lanes, bars and markers as text. Print and Word show the same timeline.

## Through the API

Scripts read the same results, with the same permissions, through `GET /api/v1/reports/properties`, `GET /api/v1/reports/content-by-label` and `GET /api/v1/pages/{pageId}/related-labels`. The API reference at `/api/docs` of your instance describes their parameters.
