# Templates

Templates give new pages a starting point: a title, input fields that are asked for when the page is created, and content with instructions. Lunedo ships built-in templates in English and German. Your own templates exist at three levels.

| Level | Who manages them | Where | Who can use them |
|---|---|---|---|
| Built-in | nobody, they come with Lunedo | **Settings › Organization › Content › Templates**, below the own templates | editors in every standard space |
| Instance | instance administrators | **Settings › Instance › Content › Templates** | editors in the standard spaces of every organization |
| Organization | organization administrators | **Settings › Organization › Content › Templates** | editors in the organization's standard spaces |
| Space | space admins | **Space settings › Content › Templates** | editors of the space |

## Creating a page from a template

Create a page in a space. The gallery shows the templates of the space, the organization and the instance (**From this space**, **From the organization**, **From the instance**) and the built-in ones, in the language of your interface. A knowledge base offers only its own templates and the built-in article templates. Search by name or filter by category, or choose **Blank page**.

Choose a template, fill in its input fields and choose **Create from …**. A required field must be filled in. A date field left empty becomes today's date. Each value can have up to 200 characters. A template for meeting series asks for the name, members and rhythm of the series next; each meeting page then starts from the template.

The new page gets its own copy of the template's content and files. Changing or deleting the template later does not change pages created from it.

A **Template button** block on a page creates a page from a template with one click, below the page that holds the button; see [Blocks](blocks.md).

## Creating and editing templates

1. Open the template screen of the level, for example **Space settings › Content › Templates**.
2. Choose **Create template**.
3. Enter the name, a description and a category.
4. Add input fields and write the content.
5. Choose **Save template**.

Built-in templates cannot be changed. On the template screen of an organization, **Duplicate** copies one into the organization, including the rhythm and duration of a series template, where you can adapt it.

### Save a page as a template

Editors of a space can choose **Save as template** in the page menu. The current content, including the draft, becomes a template of the space, and the template gets its own copy of every image and file the page shows. Space admins can add input fields later.

If the page or a page above it is restricted, the dialog says that the content becomes visible to everyone who can use the templates of the space, also to editors who cannot open the page now. It saves only after you confirm this.

### Fields and their rules

| Field | Rule |
|---|---|
| Name | 1 to 100 characters |
| Description | up to 300 characters; one sentence that says when to use the template |
| Category | Meetings, Decisions, Projects, Product and engineering, Operations, Knowledge or Teams |
| Title of new pages | up to 255 characters; insert an input field with its key in braces, for example `Project '{name}'` |
| Input fields | up to 20 per template |
| Key of an input field | starts with a small letter, then letters and digits, at most 40 characters, unique in the template |
| Label of an input field | 1 to 100 characters |
| Type of an input field | Text, Date, Person or Choice |
| Options of a choice field | at least 1 and up to 30, one per line, each up to 100 characters |
| Instruction in the content | up to 500 characters |

The title may use only keys of existing input fields; otherwise the template is not saved and the message names the key.

In the content, **Input field** inserts the value of a field when the page is created, and **Instruction** inserts grey text that disappears when someone starts typing there.

### Article type

Templates of a knowledge base have an **Article type**: How-to, Troubleshooting or none. Articles created from the template get this type, and readers filter by it in the portal. Templates at other levels have no article type. See [Knowledge bases](knowledge-bases.md).

### Images and files

A template owns its files: the images it shows and the files of drawing and draw.io blocks.

- Save a new template first; then you can add images with the image button or by dropping them into the content.
- Templates hold PNG, JPEG, GIF, WebP and SVG images up to 5 MiB. SVG images are cleaned of scripts and links.
- Removing an image from the content and saving removes the file.
- When storage is almost full, new images are refused with the usual storage message.
- Deleting a template deletes its files.

## Deleting a template

Choose **Delete template** in the actions of the template. It disappears from the gallery; pages created from it stay as they are.

## Exporting and importing

Templates can be exported as a file and imported into another Lunedo instance or another level. On the template screen, select templates and export them, or choose **Export all**; choose **Import** to read a file. When a template with the same name exists, choose **Replace the existing template** or **Import under a new name**. See [Sharing templates](template-sharing.md) for the details, and [Template file format](../api/template-format.md) for the file itself.

Exports, imports, saving a restricted page as a template and changes to organization and instance templates are recorded in the [audit log](../admin/audit-log.md).
