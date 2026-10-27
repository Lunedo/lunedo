# Re-importing newer content

A migration can run in stages: import a newer export of the same source into the space an earlier import created. Lunedo compares it with what it imported before and lists the changes. **Nothing changes until the changes are applied.**

## Starting a re-import

1. Open the accepted import under **Settings › Organization › Content › Import**.
2. Choose **Re-import a newer export**.
3. The wizard asks for the file or the connection and, for a Confluence export file, for the way people are recognized. Placeholders mapped earlier stay mapped. There is no step **Space**: a re-import goes into the space of the earlier import.
4. In **Check and start**, start the comparison.

Starting, deciding and applying a re-import needs the permission to import and the permission to manage the space.

Lunedo accepts only content from the same source:

- **Confluence**: an export or a connection for the same Confluence space; the space ID decides. A space imported from its XML export can be re-imported through the API and the other way round. Lunedo refuses any other space with a message. Use the same export format as before: the XML and the CSV export write some references differently, so a change of format can show unchanged pages as updated.
- **Markdown folder**: a ZIP file with the same top-level folder.
- **Word documents**: documents are recognized by their file names.

A newer re-import replaces an open re-import of the same space and evaluates its open decisions again.

## What the comparison finds

Every import records, for each page, blog post, template and space permission, the version and a checksum it came from, as well as labels, restrictions, the parent page and the titles. The changes are sorted into the tabs **Changed on both sides**, **New and updated**, **Deleted at the source**, **Moved** and **Permissions**.

- **New** pages are created where they are in the source, with their restrictions.
- Pages **changed only at the source** get a new version marked as from Confluence; the earlier version stays in the history. Unchanged pages are skipped.
- Pages **changed on both sides** are conflicts and are never overwritten automatically. For each conflict, also for many at once, choose **Keep Lunedo version**, **Take Confluence version** (a new version) or **Keep both**: the Lunedo version stays current and the Confluence version is added to the history, marked "from Confluence, not applied", where the two can be compared.
- **Compare** shows a conflict before you decide: the current Lunedo content next to the content of the new export, converted as it would be applied, in the same view as the comparison of two versions. Comparing changes nothing.
- A page with an open **editing session** is held like a conflict. A re-import never writes into a document someone is editing; a decided change is applied once the session has ended.
- Pages **deleted at the source** are listed. For each, choose **Move to the trash** or **Keep in Lunedo**. Nothing happens without a decision.
- Pages **moved at the source** follow, unless they were moved in Lunedo since the last import; then they stay and are listed.
- New comments and attachments are added; new versions of an attachment become versions. Comments and attachments deleted at the source are only listed.
- Added labels are added. A label removed at the source is removed only if nobody touched it in Lunedo.
- Macros are converted with the current converters, so pages improve when the converters improve.
- Nothing notifies anyone, as in the first import.

## Restrictions and permissions

**Permissions are never changed by a re-import by itself.** Where the permissions at the source changed since the last import and Lunedo does not match them yet, the tab **Permissions** lists the difference. Choose **Apply…** on one of them: Lunedo shows who gains or loses access, and applying it is recorded in the [audit log](../audit-log.md).

- A page whose restrictions were narrowed at the source is held: its new content, comments and attachments wait until the restriction is applied in Lunedo or someone decides. Until then only **Keep Lunedo version** is possible and no Confluence content is stored.
- When a page, one of its parent pages or the space is restricted further at the source, **Compare** shows the new content only to people who keep access once those restrictions are applied. People who may only read the page see its latest version instead of the draft.
- A restriction is applied exactly as at the source, with the people and groups named there. Applying it gives the person who applies it no access; if the source does not name them, they can no longer read the page afterwards.

## Applying the changes

**Apply changes** applies everything that is decided and leaves open conflicts and deletions waiting, without a deadline.

- A re-import changes only pages the person applying it may edit. Changes to other pages wait for someone with access; such a person sees them, others see only how many are hidden.
- Applying again changes nothing that was applied already.
- An interrupted run continues where it stopped.
