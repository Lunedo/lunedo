# Trash and archive

Deleting moves content to the trash, where it can be restored for a while. Archiving keeps content readable but read-only and takes it out of the page tree. This page shows how to do both and how to bring content back.

## Delete a page

1. In the page tree, open the menu of the page, folder, link or whiteboard.
2. Choose **Move to trash**.

Everything below the item goes to the trash with it, as one entry. A message names the number of items below it and offers **Undo**. Blog posts are moved to the trash from the menu of the post.

Editors and space admins can delete. The overview page of a space cannot be deleted, and neither can a page that has the overview page below it.

In the trash, content is no longer in the page tree or in search, and nobody can open it. In the editor, a link to a page in the trash shows its title followed by "(In trash)".

## The two stages

Deleted content passes through two stages before it is deleted for good:

| Stage | Who can restore | How long |
|---|---|---|
| **Space trash** | Editors and space admins of the space | **Time in the trash**, default 90 days |
| **Second-stage recovery** | Organization administrators; in a confidential space, its space admins | **Time in second-stage recovery**, default 45 days |

After the second stage the content and all its versions are deleted for good. The **Removed for good in** column of the trash shows how many days are left.

Both times are set per organization under **Settings › Organization › Content › Pages and trash** (section **Trash**) and per space under **Space settings › Content › Pages and trash**. A space inherits the organization value unless it sets its own, and the organization can lock the value. Each time lies between 1 and 3650 days. Instance administrators set a shortest allowed time for both stages under **Settings › Instance › People and sign-in › Policies** (section **Trash**, default 1 day); organizations and spaces cannot go below it.

## Restore from the trash of a space

1. Open the space and choose **Trash** at the bottom of the sidebar. The link is there for editors and space admins.
2. Choose **Restore** next to the entry.

The content goes back to its old place in the page tree, with its history. If its old place no longer exists, it goes to the top level of the page tree.

The trash lists only entries you could edit. Entries of a restricted page are visible only to people who have access to that page.

### When the page above is in the trash too

If the page it was below is also in the trash, Lunedo asks: **Restore both** puts it back at its place below the restored parent, **Restore only "…"** puts it at the top level.

If the parent page restricted who can view the content, the content is not restored alone, because it would lose that view restriction. Restore it together with the pages above it (**Restore with pages above**). That needs the right to restore each of those entries; if you lack it, ask a space or organization administrator to restore the parent pages first. See [Sharing and restrictions](../sharing-and-restrictions.md).

## Empty the trash of a space

Space admins can empty the trash at the end of the trash page (**Empty trash**). The entries are not deleted: they move to second-stage recovery, where editors can no longer restore them and organization administrators still can until that stage ends.

## Restore or delete content as an organization administrator

Organization administrators see the deleted content of all spaces of the organization except confidential spaces under **Settings › Organization › Content › Pages and trash**, in the panel **Deleted content**. From there they can:

- **Restore** an entry from either stage.
- **Delete permanently** an entry at once, for example after an erasure request. Enter a reason and type the title of the entry to confirm. Pages that were below it in the trash are deleted with it. The deletion and its reason are recorded in the [audit log](../../admin/audit-log.md). This action asks you to sign in again if your last sign-in is not recent.

In a confidential space, the space admins see the entries in second-stage recovery in the trash of the space and restore them there. See [Confidential spaces](../sharing-and-restrictions/confidential-spaces.md).

## Delete and restore a space

Space admins delete a space under **Space settings › General**, in the danger zone at the end of the page: choose **Delete space** and type the name of the space to confirm.

A deleted space goes straight to second-stage recovery. Nobody can open it or its pages, and links to its pages stop working. Until second-stage recovery ends, it can be restored with its content and permissions by:

- the people who were its space admins when it was deleted, as long as they are still active members of the organization: on the **Spaces** page, choose **Deleted spaces** in the filter and then **Restore**;
- organization administrators under **Settings › Organization › Content › Pages and trash**, unless the space is confidential.

A deleted personal space can be restored by instance administrators, and by its owner if the owner deleted it. See [Spaces](../../admin/spaces.md).

## Archive a page

1. In the page tree, open the menu of the page, folder or whiteboard.
2. Choose **Archive**.

The item and everything below it leave the page tree and appear in the **Archive** section of the space sidebar. The message offers **Undo**. Editors and space admins can archive. The menu of a link does not offer **Archive**. The overview page of a space, and a page that has it below it, cannot be archived.

Archived content:

- stays readable for everyone who could read it before, at the same address;
- is read-only: a banner says **Archived** and nobody can change it until it is brought back;
- is left out of search unless you turn on **Include archived content** in the search filters.

To bring it back, open its menu in the **Archive** section and choose **Bring back from the archive**. It returns to its old place, or to the top level of the page tree if that place no longer exists. If the page above it is in the trash and restricted who could view it, the same rule as for restoring applies.

## Archive a space

Space admins archive a space under **Space settings › General**, in the danger zone: choose **Archive space** and confirm.

An archived space:

- has read-only pages; readers keep their access, and versions and links stay;
- is hidden from the default list of spaces. Choose **Archived spaces** in the filter of the **Spaces** page to see it;
- is left out of search unless you turn on **Include archived content**.

To make it editable again, choose **Bring space back** at the same place. Organization administrators can also archive and restore spaces in the list under **Settings › Organization › Content › Spaces**.

Archiving and restoring pages and spaces is recorded in the [audit log](../../admin/audit-log.md).
