# Reviewing an import and its report

When an import has run, it waits in its quarantine space for review. Open it from the import list (**Open report**). The page shows the report, the people and the permissions, and the buttons to accept or discard. See [Quarantine](../imports.md#quarantine) for what accepting, discarding and stopping do.

## The report

The report has the tabs **Summary**, **Macros**, **People**, **Comments**, **Attachments** and **Permissions**. **Download the report as CSV** exports every entry; cells that start like a spreadsheet formula are escaped.

Each entry is typed, belongs to one category and names the page it concerns. Entries for a restricted page you cannot open show "A restricted page you cannot open" without its title.

| Category | What it lists |
| --- | --- |
| Macros | Macros kept as unsupported-macro blocks, queries of reports that could not be converted, macro options not taken over, charts and Jira content not imported |
| Diagrams | Missing diagram files, Gliffy diagrams converted on first edit, included diagrams on pages that were not imported, diagrams kept only as an image or without a preview |
| Attachments | References to missing files, attachments missing in the export, too large for the organization or unreadable |
| Links | Links to pages outside the import, links to other kinds of Confluence content, removed unsafe links, images from other websites, includes of pages outside the import, embeds shown as a link |
| Content | Parts of pages that could not be converted, pages that are too long, macros with too much data, mentions without a person, labels that could not be taken over |
| Comments | Inline comments whose text no longer exists and became page comments, comments over the limit of 2,000 per page |
| Archive | File names that appear twice in the archive, skipped folder entries |
| Source | Content Confluence refused to the token, pages in the trash, restrictions kept or unreadable, content types not imported, likes and watchers not read through the API, missing space permissions, Markdown that could not be converted, unresolved file links, embedded objects and comments of Word documents, unreadable images, documents that are too large, translations not imported |

The **Macros** tab counts each macro by name and shows the pages that use it. Unsupported macros keep their original data in the page; readers see a neutral notice, editors see the macro name.

## Notes in pages

Where content cannot be taken over, the import writes a short note into the page, such as "Jira content not imported." or "Confluence whiteboard not imported." Notes for converted macros, such as the Jira note, use the organization's language setting, otherwise the instance's. Notes for content types that are not imported, such as whiteboards and databases, use the language of the person who started the import: their own language setting, otherwise the organization's, otherwise the instance's. Notes exist in English and German; any other language gets English.

## People and groups

Confluence names people by account. The tab **People** lists everyone of the import who has no account in Lunedo yet, with the content they own.

- People are matched to accounts of the organization only by e-mail address. Everyone else becomes a placeholder with the best name known.
- A placeholder with an e-mail address becomes the person's account when they first sign in through a sign-in provider that confirms that address and may create accounts, or when SCIM provisions an account with that address.
- A placeholder that already holds access in another space never gets an e-mail address or a match from an import; it can only be mapped by hand.
- The list suggests members with a similar name. Nobody is mapped by name automatically.
- **Upload user list** maps remaining placeholders to members with the same e-mail address and names the others. It works before and after accepting.

Mapping a placeholder moves pages, comments, mentions, tasks, reactions and places on page restrictions to the chosen account in one step. Nobody is notified. A mapping cannot be undone. You cannot map a placeholder that holds access to your own account.

Groups from Confluence are matched by name to groups of the organization, including synchronized groups. The tab **Permissions** lists unmatched groups as "Missing group": map an existing group or create a local group with that name. Nothing is created automatically. Mapping a group you belong to or manage, or creating a group here, is recorded in the audit log as adding yourself to that group.

Before accepting, only the person who started the import maps people and groups. After accepting, everyone who may import in the organization can, so open mappings never depend on one person. The target is always an active member of the organization.

## Permissions

The tab **Permissions** shows each permission taken from Confluence with its status: **Mapped**, **Check**, **Waits for a person**, **Missing group** or **Not taken over**. How Confluence permissions become roles is described in the [Confluence reference](confluence-reference.md#permissions).

**Accept import** opens a dialog with the imported permissions filled in. Change them as needed. Roles of people and groups that are not mapped yet apply when they are mapped, also after accepting. If the export contains no space permissions, the dialog fills in the organization's defaults for new spaces.

Mapping people and groups and applying the imported permissions are recorded in the [audit log](../audit-log.md).
