# Sharing templates

Templates can be shared with other Lunedo instances, between levels of one instance and with the community as files. The people who manage templates at a level export and import them there:

| Level | Who exports and imports | Screen |
|---|---|---|
| Space | space admins | **Space settings › Content › Templates** |
| Organization | organization administrators | **Settings › Organization › Content › Templates** |
| Instance | instance administrators, also the built-in templates | **Settings › Instance › Content › Templates** |

Everyone else uses templates as usual; see [Templates](templates.md).

## Exporting templates

1. Open the template screen of the level.
2. Select templates and choose **Export 2 templates** (the button names the number), or, with nothing selected, **Export all**.
3. Check the list of templates in the file and what is removed from each.
4. Choose **Download file**.

Instance administrators can also export the built-in templates in English or German with **Export built-in templates** under **Built-in templates**, as a starting point for their own.

A template file cannot carry what only works in its own instance. Before the download, the dialog lists per template what is removed, with counts, for example "2 page links, 1 mention". It can remove:

- page links,
- mentions and assigned people,
- included pages or excerpts,
- live diagram references and whiteboard blocks,
- template buttons,
- reports bound to pages or spaces and roadmaps with page links (they stay, without the binding),
- comments, meeting topics and unsupported macros,
- files that are not part of the template.

Input fields, instructions, the template's own images and drawings, external links and embeds stay. The file contains no names of people, organizations or spaces, no titles of other pages and no address of the instance.

A file holds at most 50 templates, and an export that would be larger than 20 MiB is refused, because it could not be imported again. Export fewer templates at a time.

## Importing templates

1. Open the template screen of the level.
2. Choose **Import**.
3. Choose or drop a `.lunedo-template.json` or `.lunedo-template.zip` file of up to 20 MiB, then choose **Check file**.
4. Check the preview. Nothing is saved yet.
5. Choose **Import** with the number of templates to confirm.

The preview shows each template with its name, category, input fields and images, and **Show preview** renders its content. It also lists:

- **Good to know:** embeds this instance does not allow (they stay and show as links until an administrator allows the service), and content that was removed because it pointed to the other instance.
- **Why it cannot be imported:** problems that make a template invalid, with the template and the place.

A preview is kept for 12 hours. After that, check the file again.

### Templates with the same name

When a template with the same name exists at the level, choose per template:

- **Replace the existing template**: the template keeps its identity, so template buttons that point to it keep working.
- **Import under a new name**: the suggested name adds "(imported)" in the language of your interface; you can change it.

### Invalid templates

A file with invalid templates imports nothing unless you choose **Import only the valid templates**. When no template in the file is valid, fix the file and upload it again.

The import accepts only what the editor accepts: content that fails the editor's rules, unknown keys, files whose type does not match their content and archives with unsafe entries are refused. The full list of checks and limits is in [Template file format](../api/template-format.md).

## Templates in a Git repository

Lunedo writes template files in a fixed order and the same templates always give the same file, so templates kept in a Git repository give clean diffs. The format is described in [Template file format](../api/template-format.md).

Exports and imports are recorded in the [audit log](../admin/audit-log.md) with the level, the number of templates and what was removed or replaced.
