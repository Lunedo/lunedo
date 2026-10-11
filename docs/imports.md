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
