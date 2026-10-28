# Spaces

This page covers the rules an organization sets for spaces: who may create them, what new spaces start with, spaces without a space admin, personal spaces and the clean-up of spaces nobody uses anymore. Creating and managing your own space, visibility and space roles are described in [Spaces and pages](../user/spaces-and-pages.md); confidential spaces in [Confidential spaces](../user/confidential-spaces.md).

The organization's spaces are under **Settings › Organization › Content › Spaces**. The page needs the organization area Settings with View, and changing the defaults for new spaces needs Settings with Manage. The lists of spaces need the organization area Spaces; with Manage, administrators also act on spaces.

## Who may create spaces

Administrators with the organization area Spaces and Manage always create spaces. For members, two organization settings on the tab **Defaults for new spaces**, section **Creating spaces**, decide.

They are **Members create spaces** and **Members create confidential spaces**, both on by default. The [Settings reference](settings-reference.md#organization--content--spaces) lists their keys and whether they can be locked.

Members create confidential spaces and one-on-ones only when both are on. Guests and collaborators never create spaces. Both settings can be locked for members.

## Default permissions for new spaces

New spaces start with the organization's default permissions (`spaces.defaultPermissions`). The shipped default is visibility `organization` with all members of the organization as editors. To change them:

1. Open **Settings › Organization › Content › Spaces** and the tab **Defaults for new spaces**.
2. Under **Default permissions for new spaces**, choose the visibility and add or remove holders with their roles.

The creator of a space always becomes its space admin, sees the defaults in the create dialog and can change them there. Changing the defaults never changes existing spaces.

## Spaces without a space admin

A space always keeps at least one active space admin; a change that would remove the last one is refused. When the last space admin is deactivated, the space appears under **Spaces without a space admin** on the tab **All spaces**.

To appoint a new space admin:

1. Select **Appoint space admin** next to the space.
2. Choose a member of the organization. You cannot appoint yourself.
3. Select **Appoint space admin**.

The person can then read and edit everything in the space and manage its permissions. They are notified, and the appointment is recorded in the audit log.

Confidential spaces are listed separately by key only; their names, members and content stay hidden from administrators. When one loses its last space admin, administrators with Spaces and Manage are notified and can appoint one of its remaining members.

## Becoming space admin

In the list **All spaces**, **Become space admin …** in the actions of a space gives you the space admin role there, for example when nobody else can fix its permissions. Enter a reason of up to 500 characters. You need an active membership in the organization and a recent confirmation of your identity. The space admins are told at once, by notification and e-mail, who took the role, when and why (event **An administrator became space admin of my space**). The role appears in the permissions of the space like any other, any space admin can remove it, and the step is recorded in the audit log. Personal spaces and confidential spaces, including those of one-on-ones, do not offer this.

The same list archives, restores and deletes spaces, see [Trash and archive](../user/trash-and-archive.md).

## Personal spaces

Every active standard account can have one personal space, unless the instance setting **Personal spaces** (`spaces.personalSpaces`, default on) under **Settings › Instance › People and sign-in › Policies**, section **Organizations and spaces**, is off. It is created when the person opens it for the first time. Personal spaces are always private; the owner shares them by giving roles. They cannot post to chat channels.

When the owner is deactivated:

- **Other people still have a role in the space.** The space is listed for instance administrators under **Settings › Instance › People and sign-in › Accounts** with the filter **Personal space waits for review**, without titles or content. **Transfer** gives the space to one of the remaining active members, who becomes space admin and can read everything the former owner wrote there. Instead, administrators with Spaces and Manage in the owner's home organization appoint one of the remaining members as space admin under **Personal spaces of deactivated people** on the tab **All spaces**. Both are recorded in the audit log.
- **Nobody remains.** Instance administrators can only delete the space, or it appears under **Clean up** after the waiting period.

Instance administrators with the area Accounts and Manage transfer and delete personal spaces; the area Accounts with View shows the list. A deleted personal space goes to the second stage of the trash and can be restored by instance administrators until its retention period ends.

## Cleaning up spaces without active members

Personal spaces, one-on-ones and confidential spaces nobody can open anymore appear on the tab **Clean up** once nobody active has been in them for the waiting period. The list shows key, kind, size, number of pages, last activity and former members, never names or content. Personal spaces count for the home organization of their owner.

**Waiting period before clean-up** sets the waiting period in days, 30 by default and at least 7. The [Settings reference](settings-reference.md#organization--content--spaces) lists its key and allowed values.

To delete such a space:

1. Open the tab **Clean up** and select **Delete …** next to the space.
2. Enter a reason; it goes into the audit log.
3. Type the key of the space to confirm and select **Delete space**.

The space and its pages go to the second stage of the trash without anyone reading them, and are deleted for good when the retention period ends. Until then only the people who were its space admins can restore it, and for personal spaces the instance administrators. The tab needs the organization area Spaces with Manage and a recent confirmation of identity.
