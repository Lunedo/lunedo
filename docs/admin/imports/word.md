# Importing Word documents

Lunedo imports Word documents (`.docx`) into a new space. Each document becomes a page. For an overview of all sources, see [Imports](../imports.md).

## Steps

1. In the step **Source**, choose **Word documents**.
2. In the step **Upload**, add one or more `.docx` files: up to 50 per import and 100 MiB each.
3. Under **Pages**, choose **One page per document** or **A subpage per top-level heading**. Changing this reads the documents again.
4. Fill in the step **Space** and start the import in **Check and start**.

Save older `.doc` files as `.docx` first.

## What is taken over

- Each document becomes a page named after its title, or after the file name when it has none. With **A subpage per top-level heading**, every top-level heading starts a subpage of the document's page.
- Headings, paragraphs, bulleted and numbered lists, tables and links are taken over.
- Images become attachments of the page.
- Footnotes and endnotes become numbered notes at the end of the page.
- Embedded objects such as spreadsheets become attachments, with a report entry.
- Word comments are left out, with a report entry.

## Refused documents

- Documents with macros are never run or imported. `.docm` files are refused when they are added, and documents with macro parts are refused while reading.
- Encrypted, damaged and old `.doc` files fail with a message that names the file.
- Documents larger than 100 MiB are refused.

Lunedo converts documents on the server with [mammoth](https://github.com/mwilliamson/mammoth.js), without a browser or office suite. Before converting, it checks each document like an archive and rebuilds it without embedded objects and macro parts.

## Re-importing documents

Newer versions of the same documents can be imported into the same space with a [re-import](reimport.md). Lunedo recognizes each document by its file name.
