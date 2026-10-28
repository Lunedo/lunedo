# Blocks

A page, blog post or template is made of blocks: paragraphs, headings, lists, tables, reports, diagrams and more. This page lists every block of the editor with what it is for, how to insert it and its limits. Pages linked below describe the larger blocks in detail.

## Inserting blocks

- Type `/` at the start of a line or after a space (not inside a code block). The menu groups the blocks under **Text**, **Lists**, **Blocks** and **In the text**. Keep typing to filter: the menu matches the name, the description and a few keywords, for example `/toc` or `/divider`. With nothing typed yet, **Recently used** shows the last three blocks you inserted.
- The toolbar has buttons for the common blocks and an **Insert** menu with all blocks and inline elements.
- Some blocks have a typing shortcut, shown at the right of the menu entry, for example `#` for a heading or `-` for a bulleted list.
- Paste or drop files into the editor to upload them. Images that can be previewed become image blocks, other files become file blocks.

The tables below give the name to type after `/` and the shortcut where there is one.

## Text

| Block | Insert | Purpose and limits |
|---|---|---|
| Paragraph | `/Paragraph` | Plain text. |
| Heading 1 to Heading 6 | `/Heading 1` … `/Heading 6`, or `#` … `######` | Section titles. They fill the table of contents and the outline of the page. |
| Quote | `/Quote`, or `>` | Quoted text. |
| Code block | `/Code block`, or ```` ``` ```` | Code with syntax highlighting. Choose the language in the block, or **Plain text**. |
| Divider | `/Divider`, or `---` | A line between sections. |

Text inside blocks can be bold, italic, underlined, struck through, subscript, superscript, inline code, colored or highlighted, and can carry links. **Clear formatting** removes all of it.

## Lists

| Block | Insert | Purpose and limits |
|---|---|---|
| Bulleted list | `/Bulleted list`, or `-` | List with bullet points. |
| Numbered list | `/Numbered list`, or `1.` | List with numbers. |
| Task list | `/Task list`, or `[ ]` | Checklist. Each task can have an assignee and a due date. Tasks assigned to someone in published content appear in their **My tasks** list. |

## Structure

| Block | Insert | Purpose and limits |
|---|---|---|
| Info, Tip, Note, Warning, Error panel | `/Info panel` and so on, or **Callout** in the toolbar | Highlighted box. The panel type can be changed later. |
| Expand | `/Expand` | Content that readers open on demand, with a title of up to 500 characters. |
| Two, Three, Four columns | `/Two columns` and so on, or **Column layout** in the toolbar | Content side by side, 2 to 4 columns. The toolbar also offers **Sidebar on the left** and **Sidebar on the right**. Each column is 5 to 95 % wide, and the widths add up to 100 %. |
| Table | `/Table`, or `/table 4x3` | Opens **Insert table** to choose the size; `/table 4x3` inserts 4 columns × 3 rows directly. Up to 20 columns and 20 rows when inserting. Cells can be merged and split, rows and columns sorted and moved. |
| Tabs | `/Tabs` | Named tabs, each with its own content. At most 20 tabs, names up to 100 characters. See [Embeds and blocks](blocks/embeds-and-blocks.md). |
| Table of contents | `/Table of contents` | Links to the headings of this page, by default levels 1 to 3; any range from 1 to 6 can be set. |

## In the text

| Element | Insert | Purpose and limits |
|---|---|---|
| Mention | `/Mention`, or `@` | Names a person. See [Notifications](notifications.md). |
| Link to a page | `/Link to a page`, or `[[` | Link to a page in any space you can read. Linking to a page that does not exist yet creates it when the link is opened. |
| Status | `/Status` | Colored label such as "To do", 1 to 40 characters. |
| Date | `/Date` | Today's date, changeable. |
| Formula in text | `/Formula in text`, or `$…$` | Formula inside a sentence, written in LaTeX. |
| Emoji | `/Emoji` | Opens the emoji picker. |

## Formulas

| Block | Insert | Purpose and limits |
|---|---|---|
| Formula | `/Formula`, or `$$` followed by a space | Formula on its own line, written in LaTeX, up to 10,000 characters. |

## Media

| Block | Insert | Purpose and limits |
|---|---|---|
| Image or file | `/Image or file`, or **Image or file** in the toolbar | Uploads files and inserts them. Images can be set to small, medium, large or full width, aligned left, center or right, framed, and given an alternative text. Other files show as a link; some can show a preview of 150 to 2000 pixels in height. See [Embeds and blocks](blocks/embeds-and-blocks.md). |
| Attachment list | `/Attachment list` | List of the files attached to this page, optionally limited to up to 20 file types. |
| External embed | `/External embed` | Video, design, presentation or document from a service on the allowlist. Other addresses show as a link. See [Embeds and blocks](blocks/embeds-and-blocks.md) and, for administrators, [Embeds](../admin/embeds.md). |

## Diagrams and drawings

| Block | Insert | Purpose and limits |
|---|---|---|
| draw.io diagram | `/draw.io diagram` | Network, flow and UML diagrams, edited in draw.io. |
| Mermaid diagram | `/Mermaid diagram` | Diagram from text in Mermaid syntax. |
| PlantUML diagram | `/PlantUML diagram` | Sequence, class and other UML diagrams from text. |
| Drawing | `/Drawing` | Hand sketch with shapes, arrows and sticky notes. See [Whiteboards](whiteboards.md#drawings-in-pages). |
| Link to whiteboard | `/Link to whiteboard` | Preview of a whiteboard that opens it. Readers see it only if they can open the whiteboard. See [Embeds and blocks](blocks/embeds-and-blocks.md#whiteboard-blocks). |

A draw.io diagram from another page appears as **draw.io diagram from another page**. It is read-only and comes from imported content. Details and limits of all diagram blocks: [Diagrams](blocks/diagrams.md).

## Reports and lists

| Block | Insert | Purpose and limits |
|---|---|---|
| Task report | `/Task report` | Table of tasks with filters and counts. |
| Page report | `/Page report` | Table of pages with a label, or of the latest changes, up to 100 entries. |
| Decision report | `/Decision report` | List of the decisions made on pages, filtered by label or parent page. |
| Page properties | `/Page properties` | Names and values that reports collect from many pages. Names have at most 200 characters. |
| Page properties report | `/Page properties report` | Table of the page properties of pages with labels, up to 30 columns and 100 rows per page of the table. |
| Content by label | `/Content by label` | List of pages and blog posts with labels, up to 100 entries. |
| Related labels | `/Related labels` | Labels used together with the labels of this page. |
| Child pages | `/Child pages` | List of the pages below this page or another page, 1 to 10 levels or all levels, in tree order, by title, by creation date or by last change. |

Reports and lists show only what the reader may see. Filters take at most 20 labels, pages or spaces each. See [Reports and reuse](blocks/reports-and-reuse.md).

## Reuse

| Block | Insert | Purpose and limits |
|---|---|---|
| Excerpt | `/Excerpt` | Part of this page that other pages can include. It can have a name of up to 100 characters and can be hidden on its own page. An excerpt cannot contain another excerpt. |
| Include excerpt | `/Include excerpt` | Shows the excerpt of another page. |
| Include page | `/Include page` | Shows the content of another page. |
| Template button | `/Template button` | Button that creates a page from a template below this page. Only editors of the space can use it. |

Readers see included content only if they can read its page. Includes inside includes go at most 3 levels deep, and content that would include itself is not shown. See [Reports and reuse](blocks/reports-and-reuse.md) and [Templates](templates.md).

Templates also have placeholders and input fields that are filled in when a page is created; they are inserted in the template editor. See [Templates](templates.md).

## Meetings

| Block | Insert | Purpose and limits |
|---|---|---|
| Decision | `/Decision` | Records a decision so it appears in the decision log and in decision reports. |
| Topic update | Added by the meeting | In meeting notes, one block per topic on the agenda holds what was said about it. It shows **Closed** when the topic is closed. |

## Blocks from imports

These blocks are created by imports and cannot be inserted from the menu:

| Block | What it shows |
|---|---|
| Roadmap | A read-only timeline with lanes, bars, markers and months. **Show as list** shows it as text. See [Reports and reuse](blocks/reports-and-reuse.md). |
| draw.io diagram from another page | See [Diagrams](blocks/diagrams.md). |
| Unsupported macro | "Unsupported macro: *name*" for content the import could not convert. See [Import review and report](../admin/imports/review-and-report.md). |

Knowledge base articles made from the built-in article templates **How-to** and **Troubleshooting** are divided into sections, such as "Steps" or "What you see", "Cause" and "Solution". The sections come with the template. See [Knowledge bases](knowledge-bases.md).
