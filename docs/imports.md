# Imports

Organization administrators import a Confluence space export into a new space. Both export formats are supported: the XML export and the CSV export of Confluence Cloud and Data Center.

## Flow

1. Choose the file: upload it in the browser or pick it from the import folder.
2. Choose how people are recognized: a read-only Atlassian API token, a user list exported from the Atlassian administration, or skip with a confirmation.
3. Name the new space, choose its key, whether the full page history is imported, whether it is archived after accepting, and the reviewers.
4. Check the analysis and start the import.

The import runs as a background job in the phases space, people, pages, attachments, content, comments, reactions, permissions and finish. It is resumable: after a restart or a node failure, another worker continues from the last checkpoint. Every imported object is mapped by its source ID, so repeating a phase never creates duplicates. Only one worker runs an import at a time.

Unfinished setups are kept as drafts and can be continued.

## Quarantine

Imported content lands in a quarantined space. Only the importer and the chosen reviewers can see it, and it is read-only. The importer then:

- accepts the import: the space leaves quarantine with the permissions taken from Confluence, which can be changed before accepting;
- discards it: the space and everything imported is deleted;
- or stops a running import.

Discarding and stopping require typing the space key. Reviewers can read the space and the report but cannot accept, discard or stop. The importer is notified when an import is ready for review or failed.

## Report

The report lists problems by category: macros, attachments, links, content and archive. Each entry is typed and can be exported as CSV.

- Confluence macros are kept as unsupported-macro blocks. Readers see a neutral notice; editors see the macro name. The report counts each macro by name.
- Links to pages inside the export are rewritten. Links to other pages keep their original address and are reported.
- Only the current version of each page is imported, unless the full page history was chosen. Attachments keep all versions.

## People

Confluence exports name people only by an Atlassian account ID. The people step adds names and e-mail addresses:

- **API token.** The importer enters the Confluence Cloud site, their Atlassian e-mail address and a read-only API token. Pagehall checks it at once against that site only, stores it with envelope encryption, uses it only while the import runs and deletes it when the import is accepted, discarded, stopped or fails. The token never appears in responses, logs, job payloads or audit entries. Sites must be `https` hosts under `atlassian.net`; instance administrators can allow further host names in the instance setting for imports.
- **User list.** A CSV file from admin.atlassian.com › Directory › Users › Export users, up to 10 MB.
- **Skip.** Every author becomes a placeholder named by the Atlassian ID.

People are matched to accounts of the organization only by e-mail address. Everyone else becomes a placeholder with the best name known. Placeholders with an e-mail address are taken over when the person signs in with that verified address. A placeholder that already holds access in another space never gets an e-mail address or a match from an import; it can only be mapped by hand.

The report lists the placeholders with the content they own and members with a similar name as suggestions. Nobody is mapped by name automatically. Mapping moves authorship, comments, mentions, tasks, reactions and page restrictions to the account in one transaction; it cannot be undone and is audited. Administrators cannot map a placeholder that holds access to their own account. A user list can also be uploaded in the report, before and after accepting.

## Comments, likes, blog posts and history

- Page comments keep their replies, authors and times. Replies to replies are attached to the thread.
- Inline comments are anchored to their text. Resolved ones arrive resolved. When the text no longer exists, the comment becomes a page comment that starts with the quoted text, and the report lists it.
- Likes become 👍 reactions by the same person. Watchers are counted in the report.
- Blog posts keep their title, content, labels, attachments, author and date and are published at that date.
- With the full page history, every Confluence version becomes a Pagehall version with its author and date; the current version stays the published one. Versions are read in small batches.

## Permissions

- Each person or group gets the highest space role that fits its Confluence permissions: administer the space becomes space admin, add or edit pages becomes editor, comment becomes commenter, view becomes reader. Combinations that do not fit are marked for review. Anonymous access is never taken over. "All licensed users" becomes all members of the organization.
- Groups are matched by name to groups of the organization, including synchronized groups. Unmatched groups are listed in the report, where the importer maps an existing group or creates a local group. Nothing is created automatically. Administrators cannot map a group that opens restricted pages to a group they belong to.
- Page restrictions become view and edit restrictions as soon as the page exists in the quarantine space, also when they name only placeholders or unmatched groups. Such pages stay closed until the people and groups are mapped.
- The accept dialog fills in the imported permissions. Roles of people and groups that are not mapped yet apply when they are mapped, also after accepting.

## Notifications

An import never notifies anyone: not for mentions, tasks, comments, reactions or blog posts, neither while it runs nor when it is accepted or people are mapped. Imported mentions and task assignments are marked as delivered, so a later edit does not notify for them either.

## Large exports

There are two ways to import a large export.

### Upload in the browser

This is the normal way. Uploads are sent in parts of 16 MB, continue after an interruption without sending finished parts again, and are checked with a SHA-256 checksum at the end. Files of several gigabytes work.

The instance setting for the largest export to upload defaults to 2 GB. Instance administrators can raise it. When a file is above the limit, the wizard names the limit and both ways: ask the instance administrators to raise the limit, or to place the file in the organization's import folder.

### Import folder on the server

This is the fallback for the person who runs the server. Each organization has its own subfolder of the import folder (`PAGEHALL_IMPORT_DIR`, default `/data/import`), named after the organization's short name in addresses (its slug):

```
/data/import/<organization slug>/export.zip
```

The import wizard and the organization's import settings show the exact path. Pagehall offers only regular files directly inside the organization's subfolder; symbolic links, hidden files and further subfolders are ignored. An organization never sees files of another organization's subfolder or files at the top level. When the slug changes, the old subfolder is no longer read and the interface shows the new path; move the files there. Mount the folder read-only. Instance administrators can turn the import folder off.

Uploaded files are deleted 7 days after an import was accepted, discarded or stopped. Files in the import folder are never changed or deleted by Pagehall.

## Defensive reading

Exports are treated as untrusted input:

- ZIP archives are limited in total size, entry count, entry size and compression ratio. Entries with unsafe names and symbolic links are refused; duplicate names keep the first entry and are reported.
- XML is read as a stream without DTDs or entities, with limits on depth and element size.
- CSV is read as a stream with limits on field size, row size and field count. Cells that start like a spreadsheet formula are escaped in the CSV report.
- Converted content is validated against the editor schema. Content that does not fit becomes an unsupported-macro block.
- Files from the export never leave the quarantined space, and the only accounts an import creates are placeholders.
