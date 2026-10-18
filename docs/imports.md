# Imports

Organization administrators import into a new space: a Confluence space from its XML or CSV export, from an XML site backup or directly through the API of Confluence Cloud and Data Center, a folder of Markdown files, or Word documents. [What Pagehall takes over from Confluence](#what-pagehall-takes-over-from-confluence) lists every item and its fallback.

## Flow

1. Choose the source and provide it: upload a file in the browser, pick it from the import folder, or connect to Confluence and choose what to read (see [Sources](#sources)).
2. For a Confluence export, choose how people are recognized: a read-only Atlassian API token, a user list exported from the Atlassian administration, or skip with a confirmation.
3. Name the new space, choose its key, whether the full page history is imported, whether it is archived after accepting, and the reviewers.
4. Check the analysis and start the import.

The import runs as a background job in the phases space, people, pages, attachments, templates, content, comments, reactions, permissions, baseline and finish. It is resumable: after a restart or a node failure, another worker continues from the last checkpoint. Every imported object is mapped by its source ID, so repeating a phase never creates duplicates. Only one worker runs an import at a time.

Unfinished setups are kept as drafts and can be continued.

## Sources

The first step of the assistant chooses where the content comes from. All sources run through the same staging, quarantine, report and re-import; only the reading differs.

| Source | Input | People | Steps |
| --- | --- | --- | --- |
| Confluence export file | XML or CSV space export, or XML site backup, as ZIP | API token, user list or skip | Source, People, Space, Check |
| Confluence Cloud | Site, e-mail address, API token | From the same token | Source, Connection, Selection, Space, Check |
| Confluence Data Center | Base address, personal access token | Names from the API, no e-mail addresses | Source, Connection, Selection, Space, Check |
| Markdown folder | ZIP file | None | Source, Upload, Space, Check |
| Word documents | One or more `.docx` files | None | Source, Upload, Space, Check |

### Site backups

A site backup of Confluence (Confluence administration › Backup and restore) contains every space of the site, including personal spaces. Upload it like a space export. After reading it, the step Source lists its spaces; choose the one to import, and Pagehall reads the backup again for that space. Each import takes one space into a new space; import further spaces of the same backup one after another. Permissions of the whole site, such as who may use Confluence, are not taken over.

### Confluence Cloud and Data Center through the API

The connection step tests the connection before anything is stored: it reads the account the token belongs to and refuses a wrong token at once. The token is stored with envelope encryption, used only for this import and the imports of further spaces chosen with it, and deleted when the last of them is accepted, discarded, stopped, fails or is removed, when the importer loses the permission to import or leaves the organization, and when every draft using it was not touched for 7 days. A started import keeps the token while it is held, so that another administrator can take it over. A draft whose token was deleted says so and asks for the token again.

- Cloud: the site must be an `https` host under `atlassian.net` or a host the instance administrators allowed in the import settings. Pagehall authenticates with the e-mail address and the API token.
- Data Center and Server 7.9 or newer: the base address includes the context path, such as `https://wiki.example.com/confluence`. The host must be allowed in the import settings. Pagehall authenticates with a personal access token. For servers with a certificate from an own certificate authority, paste the certificate of the authority under Advanced; it is kept and deleted with the token.

Outgoing requests go only to the configured host, through the same protection as chat and mail deliveries: addresses in private or reserved networks are refused unless `PAGEHALL_OUTBOUND_ALLOWED_NETWORKS` allows them, which a Data Center in the own network usually needs. Redirects are not followed. The only exception are attachment downloads from Confluence Cloud, which Atlassian answers with a redirect to its media service `api.media.atlassian.com`; that one redirect is followed over HTTPS without the credentials. The token never appears in responses, logs, error messages, job payloads, audit entries or the report.

The selection step lists the spaces the token can read; choose one or more. Each space becomes an import of its own, into its own new space, with its own check, dry run, report and later re-import. Further spaces appear as drafts in the import list, sharing the connection and its token; taking a space out of the selection removes its draft. Imports over one connection read and run one after another, and the waiting ones say which space goes first. For the space of the current import, the step shows the page trees below the home page with their page counts and attachment sizes: import the whole space, or only chosen page trees. The page trees of the other spaces are chosen in their own imports. Blog posts come with the whole space. A re-import reads only the space it came from. Page history is optional and takes noticeably longer.

Pagehall reads the same content as an XML export of the space contains, into the same records, so the converters, the report and the result are the same: pages, blog posts, folders, smart links, whiteboards and databases with their tree, archived pages, bodies in the storage format, attachments with all their versions, page and inline comments with their resolution, labels, page states, page restrictions, space permissions and roles (only for tokens of space administrators; otherwise the report says so), templates and, when chosen, the earlier versions. Confluence Cloud is read through its REST API v2; only page restrictions and templates come from the REST API v1, which has no v2 counterpart for them. Data Center is read through its REST API. Confluence lists only what the token can read; content that refuses to be read later is skipped and listed in the report. Likes and watchers are not read through the API; the report says so once per import.

Reading is resumable: after a restart Pagehall continues with the next page of results or the next page, never from the start. When Confluence asks to slow down, Pagehall waits as long as `Retry-After` or Atlassian's rate limit headers ask, up to 5 minutes per wait, and shows "Confluence asked to slow down" while waiting. Longer pauses hand the work back to the job queue. Attachments are streamed into the file storage; no space is held in memory as a whole.

A space imported from its XML export can be re-imported through the API and the other way round, because both carry the same Confluence IDs.

### Markdown folders

Upload the folder as one ZIP file, or place it in the import folder. A single top-level folder in the ZIP file is the space; its name is suggested as the space name.

- Folders become the page tree. `index.md`, `_index.md` or `README.md` becomes the page of its folder; a folder without one gets an empty page named after it. The root `README.md` or `index.md` becomes the home page. Pages are sorted by file name, numbers in natural order.
- Front matter in YAML gives the title (`title`), labels (`tags`, `labels`, `keywords`, `categories`) and dates (`date`, `created`, `updated`, `modified`, `lastmod`). Other plain keys become page properties at the top of the page. Without a title, a first-level heading at the start of the file becomes the title, otherwise the file name.
- CommonMark with GitHub tables, strikethrough, task lists and autolinks is converted. Code blocks keep their language; `mermaid` code blocks become Mermaid diagrams.
- Relative links between files become page links, also to a folder; links to other files and images become attachments of the page that uses them. Obsidian `[[wiki links]]` and `[[page|text]]` find the page by file name, preferring the same folder; `![[image.png]]` embeds an image, `![[note]]` alone in a paragraph includes the other page.
- Files no page refers to become attachments of their folder's page. Hidden files and folders (such as `.obsidian` or `.git`) are ignored.
- Raw HTML and other constructs Pagehall cannot convert stay as text with a report entry; links to missing files keep their text with a report entry. Markdown files larger than 5 MB are not converted and are listed in the report.

### Word documents

Add one or more `.docx` files, up to 50 per import and 100 MB each. Each document becomes a page named after its title, or after the file name when it has none. Headings, paragraphs, bulleted and numbered lists, tables, links and images are taken over; images become attachments of the page, footnotes and endnotes become numbered notes at the end of the page. Optionally every top-level heading starts a subpage of the document's page.

Pagehall converts documents with [mammoth](https://github.com/mwilliamson/mammoth.js) on the server, without a browser or office suite. Embedded objects such as spreadsheets become attachments with a report entry; Word comments are left out with a report entry. Documents with macros are never run or imported: `.docm` files are refused when they are added, and documents with macro parts are refused while reading. Encrypted, damaged and old `.doc` files fail with a message that names the file. Before mammoth reads a document, Pagehall checks the archive with the same limits as exports and rebuilds it without embedded objects and macro parts.

## What Pagehall takes over from Confluence

The table covers the XML and CSV exports of Confluence Cloud, the XML exports of Data Center and Server, the site backup and the API. "Exports" means all export formats.

| Confluence | Becomes in Pagehall | Fallback |
|---|---|---|
| Pages and their tree, home page | Pages in the same tree; the home page becomes the overview page of the space | |
| Live docs | Pages | |
| Blog posts | Blog posts with their date | |
| Folders (Cloud) | Folders | |
| Smart links in the page tree (Cloud) | Links to their address | A page with the link when the smart link has subpages or an address Pagehall does not accept |
| Whiteboards and databases (Cloud) | A page in their place with the note "Confluence whiteboard not imported" or "Confluence database not imported" | Listed in the report; exports and the API do not contain their content |
| Archived pages | Archived pages, with their subpages | |
| Pages in the trash | Not imported | Listed in the report |
| Drafts | Not imported; an unpublished draft is never a version | |
| Earlier versions | Versions with author and date, when the full page history is chosen | |
| Page comments and replies | Comments with their authors and times | |
| Inline comments | Comments anchored to their text, resolved ones resolved | A page comment with the quoted text when the text no longer exists, listed in the report |
| Attachments | Attachments with all their versions | Missing files are listed in the report |
| Images and files of other spaces | | A placeholder with the file name, listed in the report |
| Labels | Labels | Personal labels (`my:`) are left out |
| Page restrictions | View and edit restrictions with the same people and groups | Exports of Confluence Cloud mark a removed restriction with the group "tombstone". Pagehall keeps such a page restricted and lists all of them in one report entry; the API reports only the restrictions that apply. |
| Space permissions and space roles | Space roles; see [Permissions](#permissions) | App accounts, site administrators (`all-product-admins`) and permissions without access to the space get no role |
| Page states | Page statuses | |
| Templates of the space | Templates | |
| Likes | 👍 reactions (exports) | Not read through the API, listed in the report once |
| Watchers | Counted in the report | Not imported |
| Macros | See [Macros](#macros) and [diagrams](diagrams.md#importing-from-confluence) | Unsupported-macro blocks, listed in the report |
| Content properties of apps | | Not imported |
| Space description | The description of the space, as plain text up to 1,000 characters | Data Center through the API: not imported |
| Space logo | | Not imported |

## Quarantine

Imported content lands in a quarantined space. Only the importer and the chosen reviewers can see it, and it is read-only. The importer then:

- accepts the import: the space leaves quarantine with the permissions taken from Confluence, which can be changed before accepting;
- discards it: the space and everything imported is deleted;
- or stops a running import.

Discarding and stopping require typing the space key. Reviewers can read the space and the report but cannot accept, discard or stop. The importer is notified when an import is ready for review or failed.

## Report

The report lists problems by category: macros, diagrams, attachments, links, content and archive. Each entry is typed and can be exported as CSV.

- draw.io, Gliffy, Mermaid and PlantUML macros become diagram blocks, also the draw.io and Gliffy apps of Confluence Cloud; see [diagrams.md](diagrams.md#importing-from-confluence).
- Macros of other Confluence Cloud apps are kept as unsupported-macro blocks named after the app (`app:<name>`).
- Macros without a converter, and macros whose parameters a converter cannot take over, are kept as unsupported-macro blocks with their original data. Readers see a neutral notice; editors see the macro name. The report counts each macro by name.
- Links to pages inside the export are rewritten. Links to other pages keep their original address and are reported.
- Only the current version of each page is imported, unless the full page history was chosen. Attachments keep all versions.
- Notes that the import writes into pages, such as "Jira content not imported", use the default language of the organization.

## Macros

These Confluence macros become Pagehall blocks. A macro falls back to an unsupported-macro block when its content or a parameter cannot be taken over, unless the table names another fallback.

| Macro | Becomes | Fallback |
|---|---|---|
| `info`, `tip`, `note`, `warning` | Callout | |
| `panel` (`title`) | Info callout with the title in bold. Colors and border options (`bgColor`, `titleBGColor`, `titleColor`, `borderColor`, `borderStyle`, `borderWidth`) are listed as options not taken over. | |
| `expand` | Expand | |
| `status` | Status | |
| `code` | Code block | |
| `toc`, `toc-zone` | Table of contents | Unsupported with `include` or `exclude` |
| `children` | Child pages | Unsupported when the page is not part of the export |
| `attachments` | Attachment list | |
| `view-file`, `viewpdf`, `viewxls`, `viewdoc`, `viewppt` (`name`, `page`, `height`) | File block with an inline preview, its height taken over from 150 to 2,000 pixels | Unsupported when the attachment is not in the export |
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
| `widget` (Widget Connector: `url`, `height`) | Embed when the address is on the embed allowlist of the organization (an `http` address counts when its `https` form is allowed), otherwise a link | The report lists each link as "shown as a link" |
| `section` with `column` children (`width` in percent) | Columns, 2 to 4 | One column becomes its content; more than four or other content stays unsupported |
| Composition Tabs and Content Formatting Macros `deck` with `card` (`label`), `deck-container` | Tabs; the deck container is unwrapped | Unsupported when the deck holds content outside its cards, more than 20 cards or nested tabs |
| Content Formatting Macros `localtabgroup` with `localtab`, `auitabs` with `auitabspage` (`title`) | Tabs | As for decks |
| Refined `ui-tabs` with `ui-tab` (`title`); `rw-ui-tabs-macro` with `rw-tab` and `refined-tabs` with `refined-tab` (Cloud, the tabs mark where their content starts) | Tabs | As for decks |
| Aura `aura-tab-collection` with `aura-tab` (title in `summary` or in the encoded `params`) | Tabs | As for decks |
| `tabs-group` with `tab-pane`, `horizontal-nav-group` with `horizontal-nav-item`, `vertical-nav-group` with `vertical-nav-item` (`name`) | Tabs | As for decks |
| Aura `aura-panel` (`summary`), Content Formatting Macros `roundrect` (`title`) | Info callout with the title in bold | |
| Refined `ui-expand` (`title`) | Expand | |
| Table Filter and Charts `table-filter` | Its table. Filters, sorting, hidden columns, column order, pagination and row numbers are listed as options not taken over; the table block has no filter or sort options. | |
| Table Filter and Charts `table-chart`, `pivot-table` | A note that the chart or pivot table was not imported, followed by the source table | Listed in the report |
| Numbered Headings `numberedheadings`, `numbered-headings` | Its content; the page option "Number headings" is turned on (on the first import of the page) | Number formats other than decimal, start numbers, start levels, skipped levels and custom heading formats are listed as options not taken over |
| MultiExcerpt `multiexcerpt`, `multiexcerpt-macro`, `multiexcerpt-fast-block-macro` (`MultiExcerptName` or `name`, `hidden`) | Excerpt | |
| MultiExcerpt `multiexcerpt-include`, `multiexcerpt-include-macro`, `multiexcerpt-fast-include-block-macro` (`MultiExcerptName` or `name`, `PageWithExcerpt` or `page`, `addpanel`) | Include excerpt; pages outside the export are kept as with `excerpt-include` | |
| Lucidchart `lucidchart` (`documentId`, `documentName`) | The preview image stored as `<documentName>.png`, if the export has one, and a link to the document on lucid.app; an embed instead when lucid.app is on the allowlist | Listed as kept as an image, or as without a preview |
| Balsamiq `mockup` (`Name`) and `wireframe` (`initialResourceID`, `initialBranchID`, `platformArchiveName`) | The preview image (`mockup_<Name>.png`, `balsamiq_wireframe_<resource>_<branch>.png`) and the source file (`.bmml`, `.bmpr`) as a file block | Listed as kept as an image |
| Miro `miro`, `miro-board`, `miro-embed`, `realtimeboard` (`url`, `boardUrl`, `link` or `board`) | Embed when the board address is on the allowlist, otherwise a link | Listed |
| Jira `jira` (`key`, or `jqlQuery`) and `jiraissues` (`url` or `jqlQuery`) | The issue key, linked to the issue on Atlassian Cloud sites, or the query as code, followed by "Jira content not imported" | Listed in the report |

The storage formats of the third-party macros were taken from public samples and migration tools, not from an export of the IT organization, which contains none of them. Not verified: the Miro macros (the names and parameters above are assumptions), the preview attachment of Lucidchart on Data Center, Aura on Data Center, Composition Tabs on Cloud, MultiExcerpt with a plain-text page name or `nopanel`, Table Filter's `table-transformer`, `table-excerpt` and `table-spreadsheet` (they stay unsupported) and Jira's `showSummary`. Jira summaries are not stored in Confluence exports, so only keys and queries are kept.

Queries are converted when they combine labels (`label = …`, `label in (…)`, or several labels joined with `or`), spaces (`space = …`, `currentSpace()`) and the type with `and`. For content by label, labels joined with `and` become "all of the labels".

An include of a page that is not part of the export keeps the Confluence space key and title of that page and is listed in the report. It shows the page as soon as a page with that title is imported into the same organization, by a re-import or by importing its space; the including page does not change. Links from roadmap bars to pages outside the export are listed like other links and the bar keeps its title.

## People

Confluence exports name people only by an Atlassian account ID. The people step adds names and e-mail addresses:

- **API token.** The importer enters the Confluence Cloud site, their Atlassian e-mail address and a read-only API token. Pagehall checks it at once against that site only, stores it with envelope encryption, uses it only while the import runs and deletes it when the import is accepted, discarded, stopped or fails, when the importer loses the permission to import, and when the draft was not touched for 7 days. The token never appears in responses, logs, job payloads or audit entries. Sites must be `https` hosts under `atlassian.net`; instance administrators can allow further host names in the instance setting for imports.
- **User list.** A CSV file from admin.atlassian.com › Directory › Users › Export users, up to 10 MB.
- **Skip.** Every author becomes a placeholder named by the Atlassian ID.

People are matched to accounts of the organization only by e-mail address. Everyone else becomes a placeholder with the best name known. Placeholders with an e-mail address are taken over when the person signs in with that verified address. A placeholder that already holds access in another space never gets an e-mail address or a match from an import; it can only be mapped by hand.

The report lists the placeholders with the content they own and members with a similar name as suggestions. Nobody is mapped by name automatically. Mapping moves authorship, comments, mentions, tasks, reactions and places on page restrictions to the account in one transaction; it cannot be undone and is audited. Administrators cannot map a placeholder that holds access to their own account. A user list can also be uploaded in the report, before and after accepting.

Before accepting, only the person who started the import maps people and groups. After accepting, every organization administrator who manages imports can, so open mappings never depend on one person. The target is always an active member of the organization.

## Comments, likes, blog posts and history

- Page comments keep their replies, authors and times. Replies to replies are attached to the thread.
- Inline comments are anchored to their text. Resolved ones arrive resolved. When the text no longer exists, the comment becomes a page comment that starts with the quoted text, and the report lists it.
- Likes become 👍 reactions by the same person. Watchers are counted in the report.
- Blog posts keep their title, content, labels, attachments, author and date and are published at that date.
- With the full page history, every Confluence version becomes a Pagehall version with its author and date; the current version stays the published one. Versions are read in small batches.

## Permissions

- Each person or group gets the highest space role that fits its Confluence permissions: administer the space becomes space admin, add or edit pages becomes editor, comment becomes commenter, view becomes reader. Combinations that do not fit are marked for review. Anonymous access is never taken over. "All licensed users" becomes all members of the organization.
- Spaces that use roles in Confluence Cloud (Admin, Manager, Collaborator, Viewer, View only and custom roles) are taken over through the permissions of their roles, so the same rule applies: a Collaborator becomes editor, a Viewer commenter.
- App accounts of Confluence, such as the accounts of the draw.io or Teams apps, get no role; the permissions list them as not taken over. Pagehall recognizes them when the people come from an API token or from the API. Site administrators of Confluence (`all-product-admins`) get no role either.
- Groups are matched by name to groups of the organization, including synchronized groups. Unmatched groups are listed in the report, where an existing group is mapped or a local group is created. Nothing is created automatically. Administrators cannot map a group that is named in page restrictions to a group they belong to.
- Page restrictions become view and edit restrictions as soon as the page exists in the quarantine space, also when they name only placeholders or unmatched groups. Such pages stay closed until the people and groups are mapped.
- As in Confluence, restrictions only narrow access. People and groups named in a restriction are listed on it, but they get no access from it: they still need a role in the space. The import never shares a page. The report marks everyone named in a restriction without a role in the space.
- The accept dialog fills in the imported permissions. Roles of people and groups that are not mapped yet apply when they are mapped, also after accepting.

## Notifications

An import never notifies anyone: not for mentions, tasks, comments, reactions or blog posts, neither while it runs nor when it is accepted or people are mapped. Imported mentions and task assignments are marked as delivered, so a later edit does not notify for them either.

## Re-import

A migration can run in stages: import a newer export of the same Confluence space into the space an earlier import created. Open the accepted import and choose **Re-import a newer export**. The wizard asks for the file and for the way people are recognized again; placeholders mapped earlier stay mapped.

Pagehall accepts only an export of the same Confluence space (the space ID in the export decides) and refuses any other with a message. Use the same export format as before: the XML and the CSV export write some references differently, so a change of format can show unchanged pages as updated. Spaces imported before re-imports existed cannot be re-imported. Starting, deciding and applying a re-import needs permission to manage the space.

Every import records, for each page, blog post, template and space permission, the version and a checksum that came from it, as well as labels, restrictions, the parent page and the titles. Pagehall compares the newer export with this record and lists the changes. **Nothing changes until the changes are applied.**

- **New** pages are created where they are in Confluence, with their restrictions.
- Pages **changed only at the source** get a new version marked as from Confluence; the earlier version stays in the history. Unchanged pages are skipped.
- Pages **changed on both sides** are conflicts and are never overwritten automatically. For each conflict, also for many at once: keep the Pagehall version, take the Confluence version (a new version), or keep both: the Pagehall version stays current and the Confluence version is added to the history, marked "from Confluence, not applied", where the two can be compared.
- **Compare** shows a conflict before you decide: the current Pagehall content next to the content of the new export, converted as it would be applied, in the same view as the comparison of two versions. Comparing changes nothing. People who may only read the page see its latest version instead of the draft. When a page, one of its parent pages or the space is restricted further in Confluence, the new content is shown only to people who keep access once those restrictions are applied.
- A page with an open **editing session** is held like a conflict. A re-import never writes into a document someone is editing; a decided change is applied once the session has ended.
- A page whose restrictions were **narrowed at the source** is held as well: its new content, comments and attachments wait until the restriction is applied in Pagehall or someone decides.
- A restriction is applied exactly as in Confluence, with the people and groups named there. Applying it gives the person who applies it no access; if Confluence does not name them, they can no longer read the page afterwards.
- Pages **deleted at the source** are listed. For each, decide to move it to the trash or keep it. Nothing happens without a decision.
- Pages **moved at the source** follow, unless they were moved in Pagehall since the last import; then they stay and are listed.
- New comments and attachments are added; new versions of an attachment become versions. Comments and attachments deleted at the source are only listed. Added labels are added; a label removed at the source is removed only if it was not touched in Pagehall.
- Macros are converted with the current converters, so pages improve when the converters improve.
- Nothing notifies anyone, as in the first import.

**Permissions are never changed by a re-import.** Where the permissions in Confluence changed since the last import and Pagehall does not match them yet, the difference is listed. Each one can be applied after Pagehall showed who gains or loses access, and is written to the audit log.

**Apply changes** applies everything that is decided and leaves open conflicts and deletions waiting, without a deadline. A re-import changes only pages the person applying it may edit; the rest waits for someone with access. Applying again changes nothing that was applied already, and an interrupted run continues where it stopped. A newer export replaces an open re-import of the same space and evaluates its open decisions again.

## Old Confluence links

Imported pages remember their Confluence page IDs and titles, so old links keep working:

- page addresses with an ID: `/wiki/spaces/OPS/pages/123456/Title`, `/pages/viewpage.action?pageId=123456`
- Data Center paths: `/display/OPS/Title`, by the title at import time and the titles of later re-imports, and `/display/OPS/2024/01/31/Title` for blog posts
- short links: `/x/AbCd`, which encode the page ID

Pagehall resolves them at `/confluence/<old path>`. People can also paste an old link into the search (the command palette) or into the field **Paste an old Confluence link** on the import page. A link to a page the person cannot read answers exactly like a link to an unknown page.

To keep the old host name working, let a reverse proxy redirect it to Pagehall. Requests keep their path and query string, and people sign in to Pagehall as usual.

Caddy:

```
confluence.example.org {
	redir https://wiki.example.org/confluence{uri} permanent
}
```

nginx:

```
server {
    listen 443 ssl;
    server_name confluence.example.org;
    ssl_certificate     /etc/ssl/confluence.example.org.crt;
    ssl_certificate_key /etc/ssl/confluence.example.org.key;
    return 301 https://wiki.example.org/confluence$request_uri;
}
```

If Confluence ran under a context path such as `/confluence` or `/wiki`, nothing changes: Pagehall finds the page in the rest of the path. Links to Confluence Cloud (`*.atlassian.net`) cannot be redirected, because the host belongs to Atlassian; paste them into the search instead.

## Large exports

There are two ways to import a large export.

### Upload in the browser

This is the normal way. Uploads are sent in parts of 16 MB, continue after an interruption without sending finished parts again, and are checked with a SHA-256 checksum at the end. Files of several gigabytes work.

The instance setting for the largest export to upload defaults to 2 GB. Uploaded files and the data Pagehall reads from them also count against a limit per organization, 20 GB by default (instance setting "Import storage per organization"); when it is reached, new uploads and reading are refused until earlier imports are accepted, discarded or deleted. Instance administrators can raise it. When a file is above the limit, the wizard names the limit and both ways: ask the instance administrators to raise the limit, or to place the file in the organization's import folder.

### Import folder on the server

This is the fallback for the person who runs the server. Each organization has its own subfolder of the import folder (`PAGEHALL_IMPORT_DIR`, default `/data/import`), named after the organization's ID:

```
/data/import/<organization ID>/export.zip
```

for example `/data/import/0c9d6a3e-5f2b-4c1a-9e8d-7b6a5c4d3e2f/export.zip`. The ID never changes and is never given to another organization, so changing the organization's short name needs no file move, and a short name taken over from another organization never shows that organization's files. Folders named after short names are not read.

The import wizard and the organization's import settings show the exact path with a button to copy it, so an organization administrator can pass it to the person who runs the server. Pagehall offers only regular files directly inside the organization's subfolder; symbolic links, hidden files and further subfolders are ignored. An organization never sees files of another organization's subfolder or files at the top level. Mount the folder read-only. Instance administrators can turn the import folder off.

When a file is chosen, the import keeps the folder it was chosen from and reads the file only from there. If the file is replaced or changed after Pagehall analyzed it, the import fails with "The file in the import folder changed after it was read"; choose the file again in a new import.

Uploaded files are deleted 7 days after an import was accepted, discarded or stopped. Files in the import folder are never changed or deleted by Pagehall.

## Defensive reading

Exports are treated as untrusted input:

- ZIP archives are limited in total size, entry count, entry size and compression ratio. Entries with unsafe names and symbolic links are refused; duplicate names keep the first entry and are reported. A leading `./`, as site backups of Confluence Cloud write it, is removed.
- XML is read as a stream without DTDs or entities, with limits on depth, element size, the size of each object with all its fields, and the number of spaces. Only the fields Pagehall imports are kept in memory.
- CSV is read as a stream with limits on field size, row size and field count. Cells that start like a spreadsheet formula are escaped in the CSV report.
- Converted content is validated against the editor schema. Content that does not fit becomes an unsupported-macro block.
- Markdown files are read with a size limit per file; front matter is parsed as plain YAML data without custom types. Word documents are checked like archives and rebuilt without macro parts and embedded objects before they are converted.
- Files from the export never leave the quarantined space, and the only accounts an import creates are placeholders.
