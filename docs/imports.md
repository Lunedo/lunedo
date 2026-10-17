# Imports

Organization administrators import a Confluence space export into a new space. Both export formats are supported: the XML export and the CSV export of Confluence Cloud and Data Center.

## Flow

1. Choose the file: upload it in the browser or pick it from the import folder.
2. Choose how people are recognized: a read-only Atlassian API token, a user list exported from the Atlassian administration, or skip with a confirmation.
3. Name the new space, choose its key, whether the full page history is imported, whether it is archived after accepting, and the reviewers.
4. Check the analysis and start the import.

The import runs as a background job in the phases space, people, pages, attachments, templates, content, comments, reactions, permissions, baseline and finish. It is resumable: after a restart or a node failure, another worker continues from the last checkpoint. Every imported object is mapped by its source ID, so repeating a phase never creates duplicates. Only one worker runs an import at a time.

Unfinished setups are kept as drafts and can be continued.

## Quarantine

Imported content lands in a quarantined space. Only the importer and the chosen reviewers can see it, and it is read-only. The importer then:

- accepts the import: the space leaves quarantine with the permissions taken from Confluence, which can be changed before accepting;
- discards it: the space and everything imported is deleted;
- or stops a running import.

Discarding and stopping require typing the space key. Reviewers can read the space and the report but cannot accept, discard or stop. The importer is notified when an import is ready for review or failed.

## Report

The report lists problems by category: macros, diagrams, attachments, links, content and archive. Each entry is typed and can be exported as CSV.

- draw.io, Gliffy, Mermaid and PlantUML macros become diagram blocks; see [diagrams.md](diagrams.md#importing-from-confluence).
- Macros without a converter, and macros whose parameters a converter cannot take over, are kept as unsupported-macro blocks with their original data. Readers see a neutral notice; editors see the macro name. The report counts each macro by name.
- Links to pages inside the export are rewritten. Links to other pages keep their original address and are reported.
- Only the current version of each page is imported, unless the full page history was chosen. Attachments keep all versions.
- Notes that the import writes into pages, such as "Jira content not imported", use the default language of the organization.

## Macros

These Confluence macros become Pagehall blocks. A macro falls back to an unsupported-macro block when its content or a parameter cannot be taken over, unless the table names another fallback.

| Macro | Becomes | Fallback |
|---|---|---|
| `info`, `tip`, `note`, `warning` | Callout | |
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

- **API token.** The importer enters the Confluence Cloud site, their Atlassian e-mail address and a read-only API token. Pagehall checks it at once against that site only, stores it with envelope encryption, uses it only while the import runs and deletes it when the import is accepted, discarded, stopped or fails. The token never appears in responses, logs, job payloads or audit entries. Sites must be `https` hosts under `atlassian.net`; instance administrators can allow further host names in the instance setting for imports.
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

The instance setting for the largest export to upload defaults to 2 GB. Instance administrators can raise it. When a file is above the limit, the wizard names the limit and both ways: ask the instance administrators to raise the limit, or to place the file in the organization's import folder.

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

- ZIP archives are limited in total size, entry count, entry size and compression ratio. Entries with unsafe names and symbolic links are refused; duplicate names keep the first entry and are reported.
- XML is read as a stream without DTDs or entities, with limits on depth, element size, the size of each object with all its fields, and the number of spaces. Only the fields Pagehall imports are kept in memory.
- CSV is read as a stream with limits on field size, row size and field count. Cells that start like a spreadsheet formula are escaped in the CSV report.
- Converted content is validated against the editor schema. Content that does not fit becomes an unsupported-macro block.
- Files from the export never leave the quarantined space, and the only accounts an import creates are placeholders.
