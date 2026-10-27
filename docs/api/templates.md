# Templates

Templates exist at three levels: a space, an organization and the instance. Through the API you create and change them, export them as files and import files. [Templates](../user/templates.md) and [Sharing templates](../user/template-sharing.md) describe them in the interface, [Template file format](template-format.md) describes the file. The full reference is at `/api/docs` on your instance.

## Levels and permissions

Every level has the same routes under its own prefix. The permission is the one that manages templates at that level:

| Level | Prefix | Permission |
|---|---|---|
| Space | `/api/v1/spaces/{spaceId}/` | `space.manage` (space admins) |
| Organization | `/api/v1/organizations/{organizationId}/` | `organization.templates.manage` |
| Instance | `/api/v1/instance/` | `instance.templates.manage` |

## Managing templates

| Route | What it does |
|---|---|
| `GET …/templates` | Lists the templates of the level |
| `POST …/templates` | Creates a template |
| `PUT …/templates/{templateId}` | Changes a template |
| `DELETE …/templates/{templateId}` | Deletes a template |
| `POST …/templates/{templateId}/files?name=` | Adds an image to a template, sent as `application/octet-stream`; use the returned `id` as `attachmentId` in the content |
| `GET …/templates/{templateId}/files/{fileId}/content` | Sends a file of a template |

A template has `name` (1 to 100 characters), `description` (up to 300), `category`, `title` (the title of new pages, 1 to 255 characters, where `{key}` inserts the value of an input field), `fields` (up to 20 input fields), `document` (see [Document format](document-format.md)) and, for a series template, `series`. Templates of a knowledge base also have `articleType`.

Space routes only:

| Route | What it does | Permission |
|---|---|---|
| `GET /api/v1/spaces/{spaceId}/template-gallery` | Templates offered for new pages in the space, from every level | `space.edit` |
| `POST /api/v1/spaces/{spaceId}/templates/from-page` | Saves the current content of a page as a space template | `space.edit` |

Listing the templates of a space and reading their files needs only read access to the space (`space.view`). In a space, files of instance and organization templates need edit access to the space.

A page is created from a template with `POST /api/v1/spaces/{spaceId}/items` and `template: { "id": …, "values": { … } }`; see [Spaces and pages](spaces-and-pages.md#the-page-tree).

## Exporting

| Route | What it does |
|---|---|
| `POST …/templates/export-summary` | Lists per template what an export removes, for `{ "templateIds": [...] }` or `null` for all |
| `POST …/templates/export` | Sends the template file: `application/json` without files, `application/zip` with files |
| `POST /api/v1/instance/templates/built-in/export` | Sends built-in templates in a language: `{ "language": "de", "templateIds": null }` |

An export removes everything that points into the instance: links to pages and spaces, mentions, includes, live diagram references, whiteboard blocks, template buttons, reports bound to pages or spaces, and people. The template's own images and external links stay.

## Importing

| Route | What it does |
|---|---|
| `POST …/template-imports?name=<file name>` | Uploads a template file as `application/octet-stream` and returns a preview with an `id`. Nothing is saved. |
| `GET …/template-imports/{importId}/files/{fileId}/content` | Sends a checked file of the preview, for showing its images. Only the person who uploaded it can read it. |
| `POST …/template-imports/{importId}/confirm` | Imports the templates of the preview |
| `DELETE …/template-imports/{importId}` | Discards the preview. Previews are discarded after 12 hours anyway. |

The preview lists each template with its content, files, what was removed, embeds the instance does not allow, `problems` and `valid`. A template whose name exists at the level has `conflict: { templateId, suggestedName }`.

The confirmation takes:

- `decisions`: per template `{ "index": 0, "action": "create" | "replace" | "skip", "name": "…" }`. `replace` keeps the ID of the existing template, so template buttons that point to it keep working. Templates without a decision are created under their own name.
- `skipInvalid`: `true` imports the valid templates when others are not valid. Without it, a file with an invalid template imports nothing.

A conflict confirmed without a decision is refused with `templateNameTaken`. The answer lists the templates `created` and `replaced` and the number `skipped`.

```sh
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"templateIds": null}' -o ops.lunedo-template.zip \
  https://wiki.example.com/api/v1/spaces/$SPACE/templates/export

curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/octet-stream" \
  --data-binary @ops.lunedo-template.zip \
  "https://wiki.example.com/api/v1/spaces/$OTHER_SPACE/template-imports?name=ops.lunedo-template.zip"
```

## Problems

Problems with the file as a whole come as Problem Details:

| Code | Meaning |
|---|---|
| `invalidTemplateFile` | Not a template file, or `template.json` does not match the format |
| `newerTemplateFormat` | Written by a newer Lunedo; `fileVersion` and `supportedVersion` name both versions |
| `tooManyTemplates`, `tooManyTemplateFiles` | More than 50 templates or 200 files |
| `templateArchiveTooLarge`, `templateArchiveCompression` | The archive or one of its files is too large, or compressed too strongly |
| `unsafeTemplateArchive`, `nestedTemplateArchive`, `unexpectedTemplateEntry` | Links, encrypted or duplicate entries, archives inside the archive, or entries other than `template.json` and `files/` |
| `fileTooLarge`, `storageFull` | The upload is too large, or the file store is almost full |

Problems of single templates are listed in the preview under `problems` and, on a confirmation without `skipInvalid`, in `templateProblems` of `invalidTemplatesInFile`. [Template file format](template-format.md#what-the-import-checks) lists every check.
