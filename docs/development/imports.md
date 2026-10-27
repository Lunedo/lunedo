# Imports

How the import pipeline works inside. What administrators see is described in [Imports](../admin/imports.md); the public routes are in [Imports in the API](../api/imports.md).

The code lives in `packages/server/src/imports/`: readers per source under `confluence/`, `markdown/` and `word/`, the archive, XML and CSV readers under `formats/`, the pipeline in `pipeline.ts`, the job worker in `worker.ts`, re-imports in `reimport.ts` and `reimport-compare.ts`. Macro converters are modules of `packages/editor-schema/src/modules/`.

## Reading and staging

An import first reads its source into a staging store (`staging.ts`) and counts what it found. This runs in the state `analyzing`; the wizard shows the result in **Check and start**. Every source produces the same staged records (spaces, pages, attachments, comments, people, permissions, templates), so the later phases do not depend on the source.

Reading saves a checkpoint (`imports.checkpoint`, with a run ID and the reader's own position) after each batch. After a restart, reading continues from the checkpoint, never from the start.

## Phases

After **Start import**, a background job runs the phases one after another (`pipelinePhases` in `pipeline.ts`):

| Phase | Work |
| --- | --- |
| `space` | Create the quarantine space |
| `people` | Match people by e-mail address, create placeholders |
| `pages` | Create pages, blog posts and folders in their tree |
| `attachments` | Stream attachments with all their versions into the file storage |
| `templates` | Import the space templates |
| `content` | Convert page bodies, links and labels |
| `comments` | Page and inline comments |
| `reactions` | Likes |
| `permissions` | Map the space permissions to roles for the accept dialog and the report |
| `baseline` | Record version and checksum of everything imported, for later re-imports |
| `finish` | Write the report counts |

A re-import runs `reimportPhases`: `lineage`, `people`, `pages`, `moves`, `attachments`, `templates`, `content`, `labels`, `comments`, `reactions`, `deletions`, `baseline`, `finish`. Before that, the `compare` step lists the changes without writing anything.

## Checkpoints and workers

- Only one worker runs an import at a time. The worker holds a PostgreSQL advisory lock on `lunedo.import:<import ID>` while it works.
- The worker writes a heartbeat every 2 seconds. An import whose heartbeat is older than 3 minutes (outside maintenance) is taken over by another worker, which continues from the last checkpoint.
- Every imported object is recorded in `import_items` with its source ID and target ID. Repeating a phase looks up the mapping first, so it never creates duplicates.
- Every 60 seconds the worker checks that the person who started the import may still import. If not, the import moves to the state `held` and waits until another person who may import takes it over.
- Errors are retried by the job queue. After the last retry the import fails with `internalError`, or with `confluenceUnreachable` or `confluenceRateLimited` for API imports. A full storage fails the import at once with `storageFull`.
- When an import is accepted, discarded or stopped, the uploaded file is kept for 7 days (`FILE_RETENTION_DAYS`).
- Drafts with a token that were not touched for 7 days (`ABANDONED_DRAFT_DAYS`) lose their token through a sweep.

## Reading through the API

- **Confluence Cloud** is read through REST API v2. Page restrictions, templates, group names and attachment downloads use REST API v1, which has no v2 counterpart for them (`confluence/cloud-scan.ts`).
- **Data Center and Server 7.9 or newer** are read through their REST API with a personal access token (`confluence/api-reader.ts`).
- Lists are read page by page, following the next links of the API (`confluence/paging.ts`). The reading position is part of the checkpoint.
- Requests time out after 30 seconds. JSON responses may have at most 32 MiB; attachment downloads are streamed into the file storage.
- `429` and `503` answers wait as long as `Retry-After` or Atlassian's rate limit headers ask, up to 5 minutes per wait and 8 attempts per request (`confluence/api-client.ts`). The import shows "Confluence asked to slow down" while it waits. A longer wait throws, and the job queue tries again later.
- After three server or network errors in a row, with growing pauses between them, the step fails with `confluenceUnreachable` and the job queue retries it.
- All requests go through the outbound protection (`packages/server/src/outbound/`). Redirects are not followed, except the redirect of Confluence Cloud attachment downloads to `api.media.atlassian.com`, which is followed over HTTPS without credentials.
- Imports over one connection run one after another, in the order they were created. The others wait and are woken when the first ends.

## Defensive reading

Exports are untrusted input.

| Reader | Limits and rules |
| --- | --- |
| ZIP (`formats/zip.ts`) | At most 500,000 entries, 200 GiB in total, 20 GiB per entry, compression ratio 200 above 1 MiB, names up to 1,024 bytes. Unsafe names, drive letters and symbolic links are refused. Duplicate names keep the first entry and are reported. A leading `./`, as site backups of Confluence Cloud write it, is removed. |
| XML (`formats/xml.ts`) | Read as a stream without DTDs or entities. Depth up to 256, one object with all its fields up to 64 MiB, tokens up to 1 MiB, 256 attributes per element, at most 1,000 spaces. Only the fields Lunedo imports are kept in memory. |
| CSV (`formats/csv.ts`) | Read as a stream. Fields up to 16 MiB, rows up to 32 MiB, 1,000 fields per row. Cells that start like a spreadsheet formula are escaped in the CSV report. |
| Markdown (`markdown/`) | ZIP files up to 100,000 entries. Files up to 5 MiB, front matter up to 64 KiB, parsed as plain YAML data without custom types. Up to 50 page properties and 100 labels per file. |
| Word (`word/`) | Documents up to 100 MiB, checked as archives (10,000 entries, 256 MiB in total, 128 MiB per entry), then rebuilt without macro parts and embedded objects before mammoth converts them in a separate worker. Text parts up to 8 MiB. |
| User lists (`user-list.ts`) | Up to 10 MiB and 200,000 people. |

- Converted content is validated against the editor schema. Content that does not fit becomes an unsupported-macro block.
- Files from the source never leave the quarantined space, and the only accounts an import creates are placeholders.
- The Atlassian token never enters job payloads, logs, errors, audit entries or the report. The job payload carries only the import ID; the worker reads the encrypted token from the database when it runs.

## Third-party macros not verified against real exports

The converters for the following macros were written without a real export that contains them. Their names and parameters may differ in practice:

- the Miro macros `miro`, `miro-board`, `miro-embed` and `realtimeboard`, including their names and parameters;
- the preview attachment of Lucidchart on Data Center;
- Aura (`aura-tab-collection`, `aura-tab`, `aura-panel`) on Data Center;
- Composition Tabs (`deck`, `card`, `deck-container`) on Cloud;
- MultiExcerpt includes with a plain-text page name, and `nopanel`;
- Table Filter and Charts `table-transformer`, `table-excerpt` and `table-spreadsheet`, which have no converter and stay unsupported-macro blocks;
- the Jira parameter `showSummary`.

When a real export shows a different format, add it as a synthetic fixture to the converter tests.

## Report codes

`report.ts` assigns every problem code to one category: `macros`, `diagrams`, `attachments`, `links`, `content`, `comments`, `archive` and `source`. A new code needs an entry there and texts under `imports.report.codes` in the locale files.

Notes that the import writes into pages come from `defaultImportTexts` in `packages/editor-schema/src/importing.ts` and their translations in `import-texts.ts`. The pipeline picks the language of the person who started the import and falls back to English for languages without texts.

## Internal routes

`GET /api/v1/organizations/{organizationId}/import-reviewer-candidates` serves the reviewer search of the wizard. It is internal and hidden from `/api/docs`.
