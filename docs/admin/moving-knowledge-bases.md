# Moving knowledge bases

A knowledge base moves to another Lunedo instance through a Markdown export and a Markdown import. Articles keep their type, sections, images, languages and translations.

## What the export keeps

The Markdown and HTML archives of the export keep what a knowledge base needs (see [Exporting](../user/export.md)):

- Every Markdown file starts with front matter: `title`, `created`, `updated`, `labels` and a `lunedo` block with the kind, version, author, `articleType`, `language` and `translation: true` for translations.
- Sections are marked with comments around their heading and content, such as `<!-- lunedo:section key="steps" icon="list-ordered" -->` … `<!-- /lunedo:section -->`. Markdown viewers do not show them.
- Each article sits in its own folder with its images; translations sit below their article, and categories are folders.
- HTML files carry `<html lang>` and a `lunedo:article-type` meta element; sections keep their `data-section` and `data-icon` attributes.

## Moving a knowledge base to another instance

1. On the old instance, open **Space settings › Export** of the knowledge base and export it as **Markdown**.
2. On the new instance, open **Settings › Organization › Content › Import**, choose **New import** and the source **Markdown folder**.
3. Upload the ZIP file and choose **Import as a knowledge base** under **Kind of space**.
4. Fill in the step **Space**, check the result in **Check and start** and start the import.
5. Review the import in its quarantine and accept it (see [Reviewing an import](imports/review-and-report.md)).
6. Open **Space settings › Visibility** of the new knowledge base and choose its audience.

Folders become categories, files become articles with their type, sections and images, and translations are linked to their article again. Numbers are assigned anew in the order of the import, so the addresses of articles change. The new knowledge base opens only for the people and groups given a role when the import is accepted, until its audience is chosen.

The settings of the knowledge base, such as its portal address, own domain and appearance, are not part of the export, and neither are reader statistics and reviews. Set the address and appearance again on the new instance (see [Knowledge base portals](knowledge-base-portals.md)).

How the import reads the files in detail is described in [Importing a Markdown folder](imports/markdown.md#importing-as-a-knowledge-base).
