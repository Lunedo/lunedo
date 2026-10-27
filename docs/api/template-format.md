# Template file format

Lunedo exports templates as files and imports them on any instance. This page describes the file for scripts and tools that write or read template files, and what the import checks. [Templates](templates.md) lists the routes; the full reference is at `/api/docs` on your instance.

The JSON Schema [template-format.schema.json](template-format.schema.json) describes `template.json`. It is generated from the importer's validation.

## File format

A template file is one of:

- plain JSON, `<name>.lunedo-template.json`, for templates without files;
- a ZIP archive, `<name>.lunedo-template.zip`, with `template.json` at its root and the files under `files/`.

One file holds one or several templates. Lunedo writes keys in a fixed order with two spaces of indentation, and the same templates always give the same file, so templates kept in a Git repository give clean diffs.

```json
{
  "format": "lunedo-template",
  "formatVersion": 1,
  "schemaVersion": 13,
  "lunedoVersion": "1.0.0",
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
          "name": "board.png",
          "path": "files/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08.png",
          "mediaType": "image/png",
          "size": 48213,
          "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
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
              "frame": null,
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
| `formatVersion` | version of this file format, `1` |
| `schemaVersion` | version of the editor schema the documents use, `13` today; see [Document format](document-format.md#schema-version) |
| `lunedoVersion` | the Lunedo version that wrote the file, for information (1 to 100 characters) |
| `templates` | 1 to 50 templates |
| `templates[].name` | 1 to 100 characters |
| `templates[].description` | up to 300 characters |
| `templates[].category` | gallery category: `meetings`, `decisions`, `projects`, `engineering`, `operations`, `knowledge` or `teams` |
| `templates[].language` | `en`, `de`, or `null` when unknown |
| `templates[].titlePattern` | title of new pages, 1 to 255 characters; `{key}` inserts the value of an input field |
| `templates[].fields` | up to 20 input fields, see below |
| `templates[].series` | `rhythm` and `durationMinutes` (5 to 1440) of new meeting series, or `null` for a page template |
| `templates[].files` | the files the content uses: `name` shown on pages (1 to 255 characters, no path), `path`, `mediaType`, `size` in bytes and `sha256` |
| `templates[].document` | the content in the editor format of `schemaVersion` |

An input field has:

- `key`: a lowercase letter followed by letters and digits, at most 40 characters; unique within the template,
- `label`: 1 to 100 characters,
- `type`: `text`, `date`, `person` or `choice`,
- `required`: `true` or `false`,
- `options`: for `choice` fields only, 1 to 30 options of 1 to 100 characters each.

### Files

- A file lies at `files/<sha256>.<extension>`, where `<sha256>` is the lowercase hexadecimal SHA-256 hash of its content.
- Media types and extensions: `image/png` (`png`), `image/jpeg` (`jpg`), `image/gif` (`gif`), `image/webp` (`webp`), `image/svg+xml` (`svg`), `application/vnd.excalidraw+json` (`excalidraw`) and `application/vnd.jgraph.mxfile` (`drawio`).
- A document refers to a file by a UUID derived from the hash: the first 32 hexadecimal digits, with the version digit set to `8` and the variant bits to `10`. In the example, the hash `9f86d081884c7d659a2f…` gives `9f86d081-884c-8d65-9a2f-eaa0c55ad015`.
- Blocks that need an ID of their own, such as drawings, carry IDs derived the same way from their position.

## What the import checks

A template file is untrusted. The import reaches the same safety as content entered in the editor:

- **Size:** at most 20 MiB per upload, 5 MiB per file inside, 50 templates and 200 files. The error names the limit.
- **Archive:** only `template.json` and `files/<sha256>.<extension>`. Links, encrypted entries, archives inside the archive, duplicate names, more entries than allowed and a size above the limit after unpacking are refused. A file larger than 64 KiB that is compressed more than 100 to 1 is refused. Sizes are counted while unpacking, not taken from the archive's directory.
- **`template.json`:** the strict schema; unknown keys are refused. The importer also checks what a schema cannot: unique field keys, choice fields with options, the content against the editor schema, and the files.
- **Versions:** documents of an older schema version are migrated. A newer format version or schema version is refused with `newerTemplateFormat`, which names both versions.
- **Content:** every document is validated against the editor schema. Unknown nodes, marks and attributes are refused. Links follow the editor's rules, so `javascript:` and similar links are refused.
- **References:** no attribute of an imported document can point to an object of this instance. Mentions, links to pages of the instance, comments, template buttons for templates other than the built-in ones and unsupported macros are removed. Page, space, account, whiteboard and file IDs in other blocks are cleared, except references to files of the same upload, which point to the new template files. The import preview counts what was removed.
- **Files:** the type is detected from the content and must match the declared type and the SHA-256 hash. SVG images pass the SVG cleaner, diagram previews the diagram cleaner, drawings the drawing validator and draw.io diagrams the draw.io cleaner. A drawing keeps only those of its own images that are files of the same upload.
- **Embeds** keep their address. The instance's list of allowed services decides how they show, as for every page.

[Templates](templates.md#problems) lists the problem codes.
