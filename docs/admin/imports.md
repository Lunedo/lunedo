# Imports

Lunedo imports content into a new space: a Confluence space from its export file or through the Confluence API, a folder of Markdown files, or Word documents. Every import lands in a quarantine space first, where you check it before anyone else sees it.

## Who may import

Importing needs the permission to manage spaces in the organization (area **Spaces**, level manage, see [Roles and permissions](roles-and-permissions.md)). Organization administrators have it; a custom role with this permission can import as well. The imports of an organization are under **Settings › Organization › Content › Import**.

A re-import into an existing space also needs the permission to manage that space (see [Re-import](imports/reimport.md)).

## Sources

All sources run through the same quarantine, report and re-import; only the reading differs.

| Source | Input | People | Steps of the wizard |
| --- | --- | --- | --- |
| [Confluence export file](imports/confluence-export.md) | XML or CSV space export, or XML site backup, as a ZIP file | API token, user list or skip | Source, People, Space, Check and start |
| [Confluence Cloud](imports/confluence-api.md#confluence-cloud) | Site address, e-mail address, API token | From the same token | Source, Connection, Selection, Space, Check and start |
| [Confluence Data Center](imports/confluence-api.md#confluence-data-center) | Base address, personal access token | Names from the API, no e-mail addresses | Source, Connection, Selection, Space, Check and start |
| [Markdown folder](imports/markdown.md) | ZIP file | None | Source, Upload, Space, Check and start |
| [Word documents](imports/word.md) | One or more `.docx` files | None | Source, Upload, Space, Check and start |

## Steps

1. Open **Settings › Organization › Content › Import** and choose **New import**.
2. **Source**: choose where the content comes from and provide it. Upload a file from your computer, pick it from the [import folder](imports/confluence-export.md#import-folder-on-the-server), or connect to Confluence.
3. Depending on the source:
   - **People** (export file): choose how people are recognized: a read-only API token, a user list or skip.
   - **Connection** and **Selection** (Cloud and Data Center): test the connection, then choose the spaces and page trees.
   - **Upload** (Markdown and Word): add the files.
4. **Space**: name the new space and choose its key (2 to 10 letters or digits; it appears in links). For Confluence sources, **Address of the Confluence site** is optional: links to pages that are not part of the import point there, otherwise they become plain text. For an export file, choose **Current state only** or **Full page history**; for Cloud and Data Center, the **Page history** switch is in the step **Selection**. Choose whether to **Import as archived**, and the **Reviewers**.
5. **Check and start**: check what Lunedo found and choose **Start import**.

The wizard saves the draft as you go. Unfinished drafts appear in the import list with **Continue**. You can leave the page while the import runs; you get a notification when it is ready for review or failed.

What Lunedo takes over from Confluence, item by item, is listed in the [Confluence reference](imports/confluence-reference.md).

## Quarantine

Imported content lands in a quarantine space. Only the person who started the import and the chosen reviewers can see it, and nobody can change it. The person who started the import then does one of these:

- **Accept import**: the space becomes a regular space with the permissions taken from Confluence. The accept dialog fills them in; change them before accepting if needed.
- **Discard import**: the quarantine space, everything imported and the report are deleted.
- **Stop import** while it runs: the import stops and the quarantine space is deleted with everything imported so far.

Discarding and stopping ask you to type the space key. Reviewers read the space and the report but cannot accept, discard or stop.

If the person who started an import loses the permission to import, a running import pauses and waits for an administrator. Another person who may import chooses **Take over the import**, and it continues where it stopped.

Check the result in the [report](imports/review-and-report.md), map people and groups there, and accept. Later changes in Confluence can follow with a [re-import](imports/reimport.md). Old Confluence links keep working, see [Old Confluence links](imports/old-confluence-links.md).

## Import settings

Instance administrators set the limits of all imports under **Settings › Instance › People and sign-in › Policies**, section **Imports**. They apply to every organization.

| Setting | Key | Default | Range |
| --- | --- | --- | --- |
| **Largest export to upload** | `imports.maxUploadMegabytes` | 2,048 MiB | 1 to 1,000,000 MiB |
| **Import storage per organization** | `imports.maxOrganizationMegabytes` | 20,480 MiB | 1 to 10,000,000 MiB |
| **Import folder** | `imports.folderEnabled` | on | on or off |
| **Further Atlassian sites** | `imports.atlassianHosts` | empty | up to 50 host names, separated by commas |

- **Largest export to upload**: larger files are refused before the upload starts. The wizard then names the limit and both ways out: raise the limit, or place the file in the organization's import folder.
- **Import storage per organization**: uploaded files and the data Lunedo reads from them count together. When an organization reaches the limit, new uploads and reading are refused until earlier imports are accepted, discarded or deleted.
- **Import folder**: turns imports from the folder on the server on or off. The folder itself is set with `LUNEDO_IMPORT_DIR` (see [Configuration](configuration.md) and [Import folder on the server](imports/confluence-export.md#import-folder-on-the-server)).
- **Further Atlassian sites**: host names Lunedo may contact with an import's token besides sites under `atlassian.net`, such as `wiki.example.com`. A Confluence Data Center host must be listed here before anyone can connect to it.

The size of imported attachments is limited by **Largest file to upload** of the organization, like every attachment (see [Storage](storage.md)).

## Audit and API

Starting, accepting, discarding and stopping imports, mapping people and applying re-imports are recorded in the [audit log](audit-log.md); filter by the import events there.

Scripts use the same steps through the API, see [Imports in the API](../api/imports.md).
