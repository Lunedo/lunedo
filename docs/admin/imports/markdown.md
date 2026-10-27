# Importing a Markdown folder

Lunedo imports a folder of Markdown files, for example from Obsidian, a GitHub wiki, MkDocs or a Lunedo export, into a new space or a new knowledge base. For an overview of all sources, see [Imports](../imports.md).

## Steps

1. Pack the folder into one ZIP file. A single top-level folder in the ZIP file is the space; its name is suggested as the space name.
2. In the step **Source**, choose **Markdown folder**.
3. In the step **Upload**, upload the ZIP file, or choose it from the [import folder](confluence-export.md#import-folder-on-the-server). For a knowledge base, choose **Import as a knowledge base** under **Kind of space**.
4. Fill in the step **Space** and start the import in **Check and start**.

## How files are converted

- Folders become the page tree. `index.md`, `_index.md`, `README.md`, `index.markdown` or `README.markdown` (in any upper or lower case) becomes the page of its folder; a folder without one gets an empty page named after it. The root `README.md` or `index.md` becomes the home page.
- A file named like its folder, such as `Network/Network.md` as written by the Lunedo export, is also the page of that folder.
- Pages are sorted by file name, numbers in natural order.
- Hidden files and folders (such as `.obsidian` or `.git`) and `__MACOSX` folders are ignored.
- Markdown files larger than 5 MiB are not converted and are listed in the report.

### Front matter

YAML front matter at the start of a file is read as plain data:

| Front matter keys | Becomes |
| --- | --- |
| `title` | The page title |
| `tags`, `labels`, `keywords`, `categories` | Labels |
| `date`, `created`, `created_at`, `createdAt` | The creation date |
| `updated`, `modified`, `lastmod`, `last_modified`, `updated_at`, `updatedAt` | The date of the last change |
| `aliases`, `cssclass`, `cssclasses`, `draft`, `layout`, `permalink`, `slug`, `weight` | Ignored |
| `lunedo` (written by the Lunedo export) | Read, not turned into page properties |
| Any other plain key | A page property at the top of the page |

Without a title, a first-level heading at the start of the file becomes the title, otherwise the file name.

### Content

- CommonMark with GitHub tables, strikethrough, task lists and autolinks is converted. Code blocks keep their language; `mermaid` code blocks become Mermaid diagrams.
- Relative links between files become page links, also links to a folder. Links to other files and images become attachments of the page that uses them.
- Obsidian `[[wiki links]]` and `[[page|text]]` find the page by file name, preferring the same folder. `![[image.png]]` embeds an image; `![[note]]` alone in a paragraph includes the other page.
- Files no page refers to become attachments of their folder's page.
- Section comments written by the Lunedo export (`<!-- lunedo:section key="…" icon="…" -->` … `<!-- /lunedo:section -->`) become sections again.
- Raw HTML and other constructs Lunedo cannot convert stay as text with a report entry. Links to missing files keep their text with a report entry.

## Re-importing a folder

A newer ZIP file of the same folder can be imported into the same space with a [re-import](reimport.md). A re-import keeps the empty folder page of an earlier import that made one for that folder. A file named like the folder then stays a page below it, so no page moves out from under the folder page and its restrictions.

## Importing as a knowledge base

**Import as a knowledge base** creates a knowledge base instead of a space (see [Knowledge bases](../../user/knowledge-bases.md)).

- Folders become areas and topics; files become articles, with the article type, language and translations from the `lunedo` block of the front matter. Sections are kept.
- The page of a folder (`index.md`, `README.md`) becomes an article in its category, unless the front matter marks it as an article with translations below it.
- The knowledge base takes its default language from the first article that names one, otherwise from the organization, and turns on the languages of the translations.
- A file is imported as a translation only into a language Lunedo offers that differs from the language of its article and is not taken by another file of the same article. Other files become separate articles in the category, and the report lists them.
- The quarantine knowledge base has no portal. After accepting, only the people and groups given a role read it until its audience is changed in its settings.

Moving a knowledge base from another Lunedo instance works this way, see [Moving knowledge bases](../moving-knowledge-bases.md).
