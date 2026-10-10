# Imports

Organization administrators import a Confluence space export into a new space. Both export formats are supported: the XML export and the CSV export of Confluence Cloud and Data Center.

## Flow

1. Choose the file: upload it in the browser or pick it from the import folder.
2. Name the new space, choose its key, whether it is archived after accepting, and the reviewers.
3. Check the analysis and start the import.

The import runs as a background job in the phases space, people, pages, attachments, content and finish. It is resumable: after a restart or a node failure, another worker continues from the last checkpoint. Every imported object is mapped by its source ID, so repeating a phase never creates duplicates. Only one worker runs an import at a time.

Unfinished setups are kept as drafts and can be continued.

## Quarantine

Imported content lands in a quarantined space. Only the importer and the chosen reviewers can see it, and it is read-only. The importer then:

- accepts the import: the space leaves quarantine with the organization's default permissions, which can be changed before accepting;
- discards it: the space and everything imported is deleted;
- or stops a running import.

Discarding and stopping require typing the space key. Reviewers can read the space and the report but cannot accept, discard or stop. The importer is notified when an import is ready for review or failed.

## Report

The report lists problems by category: macros, attachments, links, content and archive. Each entry is typed and can be exported as CSV.

- Confluence macros are kept as unsupported-macro blocks. Readers see a neutral notice; editors see the macro name. The report counts each macro by name.
- Links to pages inside the export are rewritten. Links to other pages keep their original address and are reported.
- Mentions of people become placeholder accounts that are not able to sign in.
- Only the current version of each page is imported. Attachments keep all versions.

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
