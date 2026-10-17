# Page properties, label reports and reusable content

These blocks collect information from many pages and reuse content in several places. They are inserted with `/` in the editor or come from a Confluence import. Every block shows only what the viewer may read: pages that are restricted for the viewer, in the trash, archived or not published yet are never listed, counted or used for sorting, and their titles never appear.

## Page properties

**Page properties** is a table of names and values, for example the owner, the uplink and the status of a site. Values can contain text, links, mentions, dates, status, lists, quotes and code. Add a row with **Add property**; **Enter** in a name moves to its value, **Tab** and **Shift+Tab** move between the cells.

- **ID** separates several sets of page properties on one page. A page properties report can show only the sets with a given ID.
- **Hide on the page** hides the table from readers of the page. Reports still show its values. Editors see a dashed frame in the editor.

Only the published version of a page counts. While a page has an unpublished draft, reports show the values of the published version. A page that was never published is not listed.

## Page properties report

**Page properties report** lists pages that have page properties, with one column per property name:

- **Spaces** and **Labels** choose the pages: pages in one of the spaces (all spaces you can read when empty) with at least one of the labels.
- **Columns** are the names of the properties to show, in this order. Names are compared without case. Without columns, the report shows the names used on the listed pages.
- **Order** sorts by title or by the value of a property. Numbers in values are sorted by their value, dates in the order of the calendar. Pages without that property come last. Readers can sort by any column by selecting its heading; this does not change the block.
- **Pages per page** sets how many pages are shown at once; the report pages through the rest.
- **Heading of the first column**, **Show who created each page** and **Show the labels of each page** change what the table shows.

The report is always up to date: it reads the values when it is shown. In print and Word exports, it shows the first page of results with the permissions of the person who exports.

### How the values are stored

When a page is published, or saved in live mode, Pagehall writes the page properties of that version to the table `page_properties`: one row per property with the page, the position, the ID of the set, the name, the name in lower case, the value as editor JSON, its plain text and a sort key. Drafts never reach the table. The report filters this table by name and joins it with the page tree, the labels and the permission filter, so it answers quickly also for spaces with thousands of pages. The values stay structured, so they can later become fields of databases.

## Content by label

**Content by label** lists pages and blog posts with labels: with any or all of the labels, optionally only in some spaces, only pages or only blog posts, sorted by last change, creation or title, up to 100 entries. It can show the space, the labels and the excerpt of each page. The excerpt is the first excerpt block of the page, or the excerpt of a blog post.

## Related labels

**Related labels** shows labels that are used on the same pages as the labels of the current page, or as the labels chosen in the block, most used first. Only pages you can read count. Each label links to the pages with that label in the space.

## Excerpts and includes

An **Excerpt** marks part of a page for reuse. It can have a name, so a page can have several excerpts, and it can be hidden on its own page: then readers of that page do not see it, but it appears where it is included.

**Include excerpt** shows the excerpt of another page, by default the first one, or the one with the given name, with the title of the page above it unless that is switched off. **Include page** shows the published content of another page.

- Included content is shown with the permissions of the viewer, when it is shown. A reader who cannot read the included page sees nothing at all. Editors of the including page see "Restricted content" without the title.
- A page that would include itself, also through other pages, shows a message instead. Includes are followed up to three levels deep.
- Search finds included content only on the page it comes from, not on the pages that include it.
- Print and Word exports render included content the same way, with the permissions of the person who exports. Content from a space where exports are switched off is left out.

## Roadmaps

Roadmaps from the Confluence Roadmap Planner are imported as read-only timelines with their lanes, bars, markers and months. The title and description of a bar appear when you point at it, and a bar linked to a page opens that page if you can read it. **Show as list** lists the lanes, bars and markers as text. Print and Word show the same timeline. Roadmaps can be edited once planning is available.
