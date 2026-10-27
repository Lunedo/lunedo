# Importing a Confluence export file

Lunedo reads the XML and CSV space exports of Confluence Cloud, the XML space exports of Confluence Data Center and Server, and XML site backups. For an overview of all sources and the import settings, see [Imports](../imports.md).

## Creating the export

In Confluence Cloud, open the space, then **Space settings › General › Export space**. Choose XML or CSV and export everything you can view. In Confluence Data Center and Server, open **Space tools › Content Tools** and create the XML export there (**Back up** in version 8.3 and newer, **Export › XML** before). Confluence creates a ZIP file; upload it unchanged.

- The XML and the CSV export contain the same content, packed differently. Use the same format for every later [re-import](reimport.md) of the space, because the two formats write some references differently.
- Choose the format in the step **Source** that matches the file. If it does not match, Lunedo says so and reads the file again after you switch.

## Site backups

A site backup (in Confluence Cloud under Confluence administration › **Data management › Backup manager**, in Data Center under General Configuration › **Backup & Restore**) contains every space of the site, including personal spaces. Upload it like a space export. After reading it, the step **Source** lists its spaces; choose the one to import, and Lunedo reads the backup again for that space.

Each import takes one space into a new space. Import further spaces of the same backup one after another. Permissions of the whole site, such as who may use Confluence, are not taken over.

## People

Confluence exports name people only by an Atlassian account ID, without name or e-mail address. The step **People** chooses how Lunedo recognizes them:

- **Read-only API token**: enter the Confluence Cloud site (such as `example.atlassian.net`), your Atlassian e-mail address and an API token created at `https://id.atlassian.com/manage-profile/security/api-tokens` with **Create API token** (without scopes). Read access is enough. **Check and save token** tests it against that site only. This gives names and, where visible, e-mail addresses. The site must be an `https` host under `atlassian.net` or a host listed in **Further Atlassian sites** (see [Import settings](../imports.md#import-settings)).
- **User list from the Atlassian administration**: a CSV file from admin.atlassian.com › Directory › Users › **•••** › **Export users** (Atlassian e-mails a download link), up to 10 MiB. Use it when you cannot create a token, or for Data Center.
- **Skip for now**: every author becomes a placeholder named by the Atlassian ID. Confirm this choice; you can still upload a user list later in the report.

The token is stored with envelope encryption (see [Encryption](../encryption.md)) and used only for this import. Lunedo deletes it when the import is accepted, discarded, stopped or fails, when the person who started a draft loses the permission to import, and when the draft was not touched for 7 days. A started import keeps the token while it waits for an administrator, so that another person who may import can take it over. A draft whose token was deleted says so and asks for the token again. The token never appears in responses, logs, job payloads or audit entries.

People are matched to accounts of the organization by e-mail address only. Everyone else becomes a placeholder, which you map in the [report](review-and-report.md#people-and-groups).

## Large exports

There are two ways to bring a large export to Lunedo.

### Upload in the browser

This is the normal way. The browser sends the file in parts of 16 MiB. After an interruption the upload continues without sending finished parts again, and Lunedo checks the whole file with a SHA-256 checksum at the end. Files of several GiB work.

Uploads are limited by **Largest export to upload** (default 2 GiB), and all imports of an organization together by **Import storage per organization** (default 20 GiB), see [Import settings](../imports.md#import-settings). When a file is above the limit, the wizard names the limit and both ways out: ask the instance administrators to raise the limit, or to place the file in the organization's import folder.

### Import folder on the server

This is the way for the person who runs the server. Each organization has its own subfolder of the import folder (`LUNEDO_IMPORT_DIR`, default `/data/import`), named after the organization's ID:

```
/data/import/<organization ID>/export.zip
```

For example `/data/import/0c9d6a3e-5f2b-4c1a-9e8d-7b6a5c4d3e2f/export.zip`. The ID never changes and is never given to another organization, so changing the organization's short name needs no file move. Folders named after short names are not read.

1. Open **Settings › Organization › Content › Import**. The notice **Large exports** shows the exact path of the organization's folder with a button to copy it. The wizard shows it too.
2. Pass the path to the person who runs the server. They place the file there; mount the folder read-only.
3. In the step **Source**, choose **Server import folder** and pick the file. A new file appears without a reload.

Lunedo offers only regular files directly inside the organization's subfolder. Symbolic links, hidden files and further subfolders are ignored, and an organization never sees files of another organization's subfolder or files at the top level.

The import reads the file only from the folder it was chosen from. If the file is replaced or changed after Lunedo read it, the import fails with "The file in the import folder changed"; choose the file again in a new import.

Instance administrators can turn the import folder off with the setting **Import folder**. The wizard then offers only the upload.

### Files after the import

Uploaded files are deleted 7 days after an import was accepted, discarded or stopped. Files in the import folder are never changed or deleted by Lunedo.

## What is read

Lunedo reads pages, blog posts, folders, comments, attachments with all their versions, labels, page states, restrictions, space permissions, space templates and, when **Full page history** is chosen, the earlier versions. The [Confluence reference](confluence-reference.md) lists what each item becomes and its fallback.

Checked against Atlassian documentation, October 2026.
