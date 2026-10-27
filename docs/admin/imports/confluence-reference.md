# What Lunedo takes over from Confluence

This page lists what a Confluence import takes over and what it falls back to. It covers the XML and CSV exports of Confluence Cloud, the XML exports of Data Center and Server, site backups and the API. "Exports" means all export formats. Everything that falls back is listed in the [report](review-and-report.md).

## Content

| Confluence | Becomes in Lunedo | Fallback |
|---|---|---|
| Pages and their tree, home page | Pages in the same tree; the home page becomes the overview page of the space | |
| Live docs | Pages | |
| Blog posts | Blog posts with their date | |
| Folders (Cloud) | Folders | |
| Smart links in the page tree (Cloud) | Links to their address | A page with the link when the smart link has subpages or an address Lunedo does not accept |
| Whiteboards and databases (Cloud) | A page in their place with the note "Confluence whiteboard not imported." or "Confluence database not imported." | Listed in the report; exports and the API do not contain their content |
| Other kinds of content in the page tree (Cloud) | A page in their place with the note "Confluence content of this type not imported." | Listed in the report |
| Archived pages | Archived pages, with their subpages | |
| Pages in the trash | Not imported | Listed in the report |
| Drafts | Not imported; an unpublished draft is never a version | |
| Earlier versions | Versions with author and date, when **Full page history** is chosen | |
| Page comments and replies | Comments with their authors and times | |
| Inline comments | Comments anchored to their text, resolved ones resolved | A page comment with the quoted text when the text no longer exists, listed in the report |
| Attachments | Attachments with all their versions | Missing files are listed in the report |
| Images and files of other spaces | | A placeholder with the file name, listed in the report |
| Labels | Labels | Labels outside the global and team namespaces, such as personal labels (`my:`), are left out |
| Page restrictions | View and edit restrictions with the same people and groups | Exports of Confluence Cloud mark a removed restriction with the group "tombstone". Lunedo keeps such a page restricted and lists all of them in one report entry; the API reports only the restrictions that apply. |
| Space permissions and space roles | Space roles; see [Permissions](#permissions) | App accounts, site administrators (`all-product-admins`) and permissions without access to the space get no role |
| Page states | Page statuses | |
| Templates of the space | Templates | |
| Likes | 👍 reactions (exports) | Not read through the API, listed in the report once |
| Watchers | Counted in the report | Not imported |
| Macros | See [Macros](#macros) and [Diagrams](#diagrams) | Unsupported-macro blocks, listed in the report |
| Content properties of apps | | Not imported |
| Space description | The description of the space, as plain text up to 1,000 characters | Data Center through the API: not imported |
| Space logo | | Not imported |

Links to pages inside the import are rewritten to the imported pages. Links to other pages lead to the Confluence site given as **Address of the Confluence site**, or stay as text without it, and are reported. Only the current version of each page is imported, unless **Full page history** was chosen. Attachments always keep all versions.

## Macros

These Confluence macros become Lunedo blocks. A macro falls back to an unsupported-macro block when its content or a parameter cannot be taken over, unless the table names another fallback. Readers see a neutral notice for an unsupported-macro block; editors see the macro name. The original data stays in the page.

| Macro | Becomes | Fallback |
|---|---|---|
| `info`, `tip`, `note`, `warning` | Callout | |
| `panel` (`title`) | Info callout with the title in bold. Colors and border options (`bgColor`, `titleBGColor`, `titleColor`, `borderColor`, `borderStyle`, `borderWidth`) are listed as options not taken over. | |
| `expand` | Expand | |
| `status` | Status | |
| `code` | Code block | |
| `toc`, `toc-zone` | Table of contents | Unsupported with `include` or `exclude` |
| `children` | Child pages | Unsupported when the page is not part of the import |
| `attachments` | Attachment list | |
| `view-file`, `viewpdf`, `viewxls`, `viewdoc`, `viewppt` (`name`, `page`, `height`) | File block with an inline preview, its height taken over from 150 to 2,000 pixels | Unsupported when the attachment is not in the import |
| `content-report-table`, `recently-updated` | Page report | |
| `decisionreport`, decision lists | Decision report, decisions | |
| `tasks-report-macro` | Task report | |
| `create-from-template` | Template button | |
| `details` (`id`, `hidden`) | Page properties. The table may have the names in the first column or in the first row. | Unsupported when the body is not one table of names and values, or a value contains blocks other than text, lists, quotes and code |
| `detailssummary` (`cql`, `label`, `spaces`, `headings`, `firstcolumn`, `sortBy`, `reverseSort`, `pageSize`, `showCreator`, `showPageLabels`, `id`) | Page properties report | A query that cannot be converted into labels and spaces stays in the block as a note, and the report lists it. `showCommentsCount` and `showLikesCount` are listed as options not taken over. |
| `contentbylabel` (`labels`, `cql`, `spaces`, `type`, `operator`, `sort`, `reverse`, `max`, `excerptType`, `showLabels`, `showSpace`, `title`) | Content by label | A query that cannot be converted stays as a note and is listed; `excludeCurrent` is listed as an option not taken over |
| `related-labels` (`labels`, `title`) | Related labels | |
| `excerpt` (`name`, `hidden`) | Excerpt | |
| `excerpt-include` (page, `name`, `nopanel`) | Include excerpt | |
| `include` (page) | Include page | |
| `roadmap` | Read-only roadmap | Unsupported when the roadmap data cannot be read |
| `widget` (Widget Connector: `url`, `height`) | Embed when the address is on the [embed allowlist](../embeds.md) of the organization (an `http` address counts when its `https` form is allowed), otherwise a link | The report lists each link as shown as a link |
| `section` with `column` children (`width` in percent) | Columns, 2 to 4 | One column becomes its content; more than four or other content stays unsupported |
| Composition Tabs and Content Formatting Macros `deck` with `card` (`label`), `deck-container` | Tabs; the deck container is unwrapped. Composition Tabs on Cloud: not verified against real exports. | Unsupported when the deck holds content outside its cards, more than 20 cards or nested tabs |
| Content Formatting Macros `localtabgroup` with `localtab`, `auitabs` with `auitabspage` (`title`) | Tabs | As for decks |
| Refined `ui-tabs` with `ui-tab` (`title`); `rw-ui-tabs-macro` with `rw-tab` and `refined-tabs` with `refined-tab` (Cloud, the tabs mark where their content starts) | Tabs | As for decks |
| Aura `aura-tab-collection` with `aura-tab` (title in `summary` or in the encoded `params`) | Tabs. Aura on Data Center: not verified against real exports. | As for decks |
| `tabs-group` with `tab-pane`, `horizontal-nav-group` with `horizontal-nav-item`, `vertical-nav-group` with `vertical-nav-item` (`name`) | Tabs | As for decks |
| Aura `aura-panel` (`summary`), Content Formatting Macros `roundrect` (`title`) | Info callout with the title in bold. Aura on Data Center: not verified against real exports. | |
| Refined `ui-expand` (`title`) | Expand | |
| Table Filter and Charts `table-filter` | Its table. Filters, sorting, hidden columns, column order, pagination and row numbers are listed as options not taken over; the table block has no filter or sort options. | |
| Table Filter and Charts `table-chart`, `pivot-table` | The note "Chart not imported. Its source table follows." or "Pivot table not imported. Its source table follows.", followed by the source table | Listed in the report |
| Numbered Headings `numberedheadings`, `numbered-headings` | Its content; the page option "Number headings" is turned on (on the first import of the page) | Number formats other than decimal, start numbers, start levels, skipped levels and custom heading formats are listed as options not taken over |
| MultiExcerpt `multiexcerpt`, `multiexcerpt-macro`, `multiexcerpt-fast-block-macro` (`MultiExcerptName` or `name`, `hidden`) | Excerpt | |
| MultiExcerpt `multiexcerpt-include`, `multiexcerpt-include-macro`, `multiexcerpt-fast-include-block-macro` (`MultiExcerptName` or `name`, `PageWithExcerpt` or `page`, `addpanel`) | Include excerpt; pages outside the import are kept as with `excerpt-include`. A plain-text page name and `nopanel`: not verified against real exports. | |
| Lucidchart `lucidchart` (`documentId`, `documentName`) | The preview image stored as `<documentName>.png`, if the export has one, and a link to the document on lucid.app; an embed instead when lucid.app is on the allowlist. The preview on Data Center: not verified against real exports. | Listed as kept as an image, or as without a preview |
| Balsamiq `mockup` (`Name`) and `wireframe` (`initialResourceID`, `initialBranchID`, `platformArchiveName`) | The preview image (`mockup_<Name>.png`, `balsamiq_wireframe_<resource>_<branch>.png`) and the source file (`.bmml`, `.bmpr`) as a file block | Listed as kept as an image |
| Miro `miro`, `miro-board`, `miro-embed`, `realtimeboard` (`url`, `boardUrl`, `link` or `board`) | Embed when the board address is on the allowlist, otherwise a link. Not verified against real exports. | Listed |
| Jira `jira` (`key`, or `jqlQuery`) and `jiraissues` (`url` or `jqlQuery`) | The issue key, linked to the issue on Atlassian Cloud sites, or the query as code, followed by "Jira content not imported." `showSummary`: not verified against real exports. | Listed in the report |
| Macros of other Confluence Cloud apps | Unsupported-macro blocks named after the app (`app:<name>`) | Listed in the report |

Jira summaries are not stored in Confluence exports, so only keys and queries are kept.

Queries are converted when they combine labels (`label = …`, `label in (…)`, or several labels joined with `or`), spaces (`space = …`, `currentSpace()`) and the type with `and`. For content by label, labels joined with `and` become "all of the labels".

An include of a page that is not part of the import keeps the Confluence space key and title of that page and is listed in the report. It shows the page as soon as a page with that title is imported into the same organization, by a re-import or by importing its space; the including page does not change. Links from roadmap bars to pages outside the import are listed like other links, and the bar keeps its title.

## Diagrams

draw.io, Gliffy, Mermaid and PlantUML macros become diagram blocks, also the draw.io and Gliffy apps of Confluence Cloud (see [Diagrams](../../user/diagrams.md)).

| Confluence macro | Becomes |
| --- | --- |
| `drawio` | draw.io block with the attached diagram file (`<name>` or `<name>.drawio`) and its preview (`<name>.png`) |
| `inc-drawio` | Reference to the draw.io block of the other page |
| `gliffy` | draw.io block that shows the Gliffy preview and keeps the Gliffy file |
| draw.io app of Confluence Cloud: draw.io Diagram, draw.io Board | draw.io block with the attached diagram file and its preview, like `drawio`; boards are draw.io files too |
| draw.io app of Confluence Cloud: Embed draw.io Diagram | Reference to the draw.io block of the other page, like `inc-drawio` |
| Gliffy app of Confluence Cloud | draw.io block that shows the Gliffy preview and keeps the Gliffy file, like `gliffy` |
| `mermaid`, `mermaid-macro`, `mermaid-diagram`, `mermaid-cloud` with the source in the macro body | Mermaid block with that source |
| `plantuml` | PlantUML block with its source |

Confluence Cloud stores the draw.io and Gliffy apps as app extensions (`ac:adf-extension`) whose key ends in `drawio`, `drawio-sketch`, `inc-drawio` or `gliffy`. Lunedo reads the diagram name and page from their parameters in any order and ignores the copy Confluence keeps as fallback. A diagram name with or without `.drawio` finds the same file and the same diagram of another page.

- An `inc-drawio` macro whose page is not part of the import shows a note with the diagram name; the report lists it under "included diagrams are on pages that were not imported". To keep such a diagram, add it to the page as a draw.io diagram of its own.
- A draw.io diagram whose file is missing keeps its preview image. The report lists it under "diagram files are missing"; editing it starts an empty diagram.
- Gliffy diagrams are converted to draw.io in the browser when someone first chooses **Edit in draw.io**; the report lists them. Until then, the page shows the Gliffy image.
- Mermaid macros whose source is stored in another form, such as compressed in a parameter, stay unsupported-macro blocks with their original data.
- Imported Mermaid and PlantUML diagrams have no image until someone saves them in Lunedo; until then, pages, search and exports use their source.

## Comments, likes, blog posts and history

- Page comments keep their replies, authors and times. Replies to replies are attached to the thread. A page keeps up to 2,000 comments; the rest are left out and reported.
- Inline comments are anchored to their text. Resolved ones arrive resolved. When the text no longer exists, the comment becomes a page comment that starts with the quoted text, and the report lists it.
- Likes become 👍 reactions by the same person. Watchers are counted in the report.
- Blog posts keep their title, content, labels, attachments, author and date and are published at that date.
- With **Full page history**, every Confluence version becomes a Lunedo version with its author and date; the current version stays the published one.

## Permissions

- Each person or group gets the highest space role that fits its Confluence permissions: administer the space becomes space admin, add or edit pages becomes editor, comment becomes commenter, view becomes reader. Combinations that do not fit are marked for review. Anonymous access is never taken over. "All licensed users" becomes all members of the organization.
- Spaces that use roles in Confluence Cloud (Admin, Manager, Collaborator, Viewer, View only and custom roles) are taken over through the permissions of their roles, so the same rule applies: a Collaborator becomes editor, a Viewer commenter.
- App accounts of Confluence, such as the accounts of the draw.io or Teams apps, get no role; the permissions list them as not taken over. Lunedo recognizes them when the people come from an API token or from the API. Site administrators of Confluence (`all-product-admins`) get no role either.
- Groups are matched by name to groups of the organization, see [People and groups](review-and-report.md#people-and-groups).
- Page restrictions become view and edit restrictions as soon as the page exists in the quarantine space, also when they name only placeholders or unmatched groups. Such pages stay closed until the people and groups are mapped.
- As in Confluence, restrictions only narrow access. People and groups named in a restriction are listed on it, but they get no access from it: they still need a role in the space. The import never shares a page. The report marks everyone named in a restriction without a role in the space.

## Notifications

An import never notifies anyone: not for mentions, tasks, comments, reactions or blog posts, neither while it runs nor when it is accepted or people are mapped. Imported mentions and task assignments are marked as delivered, so a later edit does not notify for them either.
