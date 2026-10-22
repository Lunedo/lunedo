# Templates

Templates give new pages a starting point: a title pattern, input fields asked for when the page is created, and content with placeholders. They exist at three levels: the instance, an organization and a space. Lunedo also ships built-in templates in English and German.

| Level | Who manages it | Who uses it |
|---|---|---|
| Built-in | nobody, they come with Lunedo | everyone who creates pages |
| Instance | instance administrators | editors in every space |
| Organization | organization administrators | editors in the organization's spaces |
| Space | space administrators | editors of the space |

## Images and files of templates

A template owns its files: the images it shows and the files that drawing and diagram blocks use. They are stored like attachments, encrypted, counted in the storage of the organization or space, and refused with the usual message when the storage is almost full.

- **Save as template** on a page copies the current version of every file the page shows into the template. If the page or a page above it is restricted, the dialog says that its content and images become visible to everyone who can use the space's templates, and saves only after this is confirmed; the save is recorded in the audit log. Only the page's own files are taken over.
- The template editor adds images with the image button or by dropping them into the content. Templates accept PNG, JPEG, GIF, WebP and SVG images up to 5 MB; SVG images are cleaned of scripts and links. Removing an image from the content and saving removes the file.
- A page created from a template gets its own copies of the files as normal attachments. Changing or deleting the template later does not change the page.
- Deleting a template deletes its files.

Templates saved before Lunedo stored their files kept references to the attachments of the page they came from. After an update, Lunedo copies those files into the templates in the background, as long as the file still exists, the people who created and last changed the template can still open its page, and the page lies in the template's space or organization. Organization and instance templates take over files of unrestricted pages only. Images whose file is gone become empty image blocks. The worker log reports how many templates, files and emptied images it handled.

## Exporting templates

Templates can be shared with other Lunedo instances and with the community as files. The people who manage templates at a level can export them: space administrators the templates of their space, organization administrators those of the organization, instance administrators those of the instance and the built-in templates. Everyone else uses templates as before.

On the template screen of a level, select templates and choose **Export**, or export all of them. Instance administrators can export built-in templates in English or German as a starting point for their own.

A template file cannot carry what only works in its own instance. Before the download, the dialog lists per template what is removed, with counts, for example "2 page links, 1 mention":

- links to pages and spaces, including links to the instance's own address,
- mentions and people in task assignments,
- includes and excerpts of other pages,
- live draw.io references to other pages and whiteboard blocks,
- template buttons for templates of the instance (buttons for built-in templates stay),
- reports, child page lists, label lists and roadmaps bound to pages or spaces (they stay, without the binding),
- comments, meeting topics and imported macros Lunedo does not support,
- files that are not part of the template, and files that are not images, drawings or draw.io diagrams.

Template field placeholders, the template's own images, external links and embeds stay. The file contains no database IDs, authors, timestamps, organization or space names, names of people, titles of other pages or the address of the instance. Every export is recorded in the audit log with the level, the number of templates and what was removed.

## Importing templates

The same people can import at the level they manage. Choose **Import**, select a template file, and check the preview before anything is saved:

- each template with its name, category, fields, a rendered preview and its images,
- warnings: embeds this instance does not allow (they stay and show as links until an administrator allows the service) and content that was removed because it cannot point to this instance,
- problems that make a template invalid, naming the template and the place, for example "Template 'Retro', field 3: …".

When a template with the same name exists at that level, choose per template **Replace** or **New name**. Replace keeps the existing template's ID, so template buttons that point to it keep working. New name suggests "<name> (imported)" and can be edited. A file with invalid templates imports nothing unless you choose to import only the valid ones. Nothing is written until you confirm; a preview is discarded after 12 hours. Every import is recorded in the audit log with the level, the file name and the templates created and replaced.

### What the import checks

A template file is untrusted. The import reaches the same safety as content entered in the editor:

- **Size:** at most 20 MB per upload, 5 MB per file inside, 50 templates and 200 files. The error names the limit.
- **Archive:** only `template.json` and `files/<sha256>.<extension>`. Absolute paths, `..`, links, archives inside the archive, duplicate names, more entries than allowed, a size above the limit after unpacking and files compressed more than 100 to 1 are refused. Sizes are counted while unpacking, not taken from the archive's directory.
- **`template.json`:** a strict schema; unknown keys are refused. Field rules, categories and languages are those of the editor.
- **Content:** every document is validated against the editor schema. Older schema versions are migrated; a newer format version or editor schema version is refused with a message that names both versions. Unknown nodes, marks and attributes are refused. Links follow the editor's rules, so `javascript:` and similar links are refused.
- **References:** no attribute of an imported document can point to an object of this instance. Page, space, account, template, whiteboard and attachment IDs are cleared, except references to files of the same upload, which point to the new template files.
- **Files:** PNG, JPEG, GIF, WebP and SVG images, Excalidraw drawings and draw.io diagrams. The type is detected from the content and must match the declared type and the SHA-256 hash. SVG images pass the SVG cleaner, diagram previews the diagram cleaner, drawings the drawing validator and draw.io diagrams the draw.io cleaner. A drawing's own images must be files of the same upload.
- **Embeds** keep their address; the instance's list of allowed services decides when the page is shown, as for every page.

## File format

A template file is either plain JSON, `<name>.lunedo-template.json`, for templates without files, or a ZIP archive, `<name>.lunedo-template.zip`, with `template.json` at its root and the files under `files/`. One file holds one or several templates. Lunedo writes keys in a fixed order with two spaces of indentation, and the same templates always give the same file, so templates kept in a Git repository give clean diffs.

The JSON Schema [template-format.schema.json](template-format.schema.json) describes `template.json`; it is generated from the importer's validation. The importer additionally checks what a schema cannot: unique field keys, choice fields with options, the content against the editor schema, and the files.

```json
{
  "format": "lunedo-template",
  "formatVersion": 1,
  "schemaVersion": 11,
  "lunedoVersion": "1.4.0",
  "templates": [
    {
      "name": "Retrospective",
      "description": "What went well, what to change",
      "category": "meetings",
      "language": "en",
      "titlePattern": "Retro {date}",
      "fields": [
        {
          "key": "date",
          "label": "Date",
          "type": "date",
          "required": false
        }
      ],
      "series": null,
      "files": [
        {
          "path": "files/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08.png",
          "mediaType": "image/png",
          "size": 48213,
          "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
          "name": "board.png"
        }
      ],
      "document": {
        "type": "doc",
        "content": [
          {
            "type": "image",
            "attrs": {
              "align": "center",
              "alt": "Board",
              "attachmentId": "9f86d081-884c-8d65-9a2f-eaa0c55ad015",
              "width": null
            }
          }
        ]
      }
    }
  ]
}
```

| Key | Meaning |
|---|---|
| `format` | always `lunedo-template` |
| `formatVersion` | version of this format, currently `1` |
| `schemaVersion` | version of the editor schema the documents use |
| `lunedoVersion` | the Lunedo version that wrote the file, for information |
| `templates[].name`, `description`, `category` | name (1 to 100 characters), description (up to 300) and gallery category: `meetings`, `decisions`, `projects`, `engineering`, `operations`, `knowledge` or `teams` |
| `templates[].language` | `en`, `de`, or `null` when unknown |
| `templates[].titlePattern` | title of new pages; `{key}` inserts the value of an input field |
| `templates[].fields` | up to 20 input fields: `key`, `label`, `type` (`text`, `date`, `person`, `choice`), `required`, and `options` for choice fields |
| `templates[].series` | rhythm and duration of new meeting series, or `null` for a page template |
| `templates[].files` | the files the content uses: `path`, `mediaType`, `size` in bytes, `sha256` and the `name` shown on pages |
| `templates[].document` | the content in the editor format of `schemaVersion` |

A document refers to a file by a UUID derived from the file's SHA-256 hash: the first 32 hexadecimal digits of the hash, with the version digit set to `8` and the variant bits to `10`. In the example, the hash `9f86d081884c7d659a2f…` gives `9f86d081-884c-8d65-9a2f-eaa0c55ad015`. Blocks that need an ID of their own, such as drawings, carry IDs derived the same way from their position. File media types are `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/svg+xml`, `application/vnd.excalidraw+json` (extension `excalidraw`) and `application/vnd.jgraph.mxfile` (extension `drawio`).

## API

Export and import work through the API with the same permissions, limits and checks; see [api.md](api.md#templates).
