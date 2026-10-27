# Owners

Pages and most other content have an owner: the person who is responsible for the content and keeps it up to date. Ownership does not grant any access. It names who to ask, and the owner needs edit access like everyone else.

## What has an owner

Pages, folders, links, blog posts, whiteboards and meeting series have an owner.

The owner is set when the content comes into being:

- Whoever creates a page, folder, link, blog post or whiteboard owns it.
- Whoever copies content owns the copies.
- Imported pages are owned by the person who created them in the source system: the account that person was mapped to, or otherwise the placeholder account the import created for them. Pages without a known creator have no owner.
- When a placeholder account from an import is merged into a real account, the real account becomes the owner of the content the placeholder owned.

## Where the owner shows

The owner appears in the line below the page title (**Owner: …**) and on folders. People who cannot see the owner's profile see **Someone you cannot see**. If the owner is no longer active, the page shows that the owner left or was deactivated.

The history of owner changes is in the **Status and owner** section of the page's versions screen.

## What the owner does

- The owner is the person responsible for the content. In a knowledge base, review reminders for an article go to its owner. See [Knowledge base reviews](knowledge-base-reviews.md).
- A new owner automatically watches the content, unless they turned off automatic watching, and gets a notification that they were made the owner. Watchers of the content are told about the change too. See [Notifications](notifications.md).

## Transfer ownership

1. Open the page and open the menu in the line below the title.
2. Choose **Transfer ownership**, or **Assign owner** if the content has no active owner.
3. Search for the new owner by name and confirm.

Who can transfer ownership:

- the current owner;
- space admins;
- organization administrators who manage spaces and have a role in the space, except in confidential spaces.

You must be able to open the content yourself. The list offers only active people who can edit the content right now, including any edit restriction. If the person you want is missing, give them edit access first. See [Sharing and restrictions](sharing-and-restrictions.md).

The owner of archived content, of content in the trash and of meeting topics cannot be changed. Bring the content back first. See [Trash and archive](trash-and-archive.md).

Transfers are recorded in the [audit log](../admin/audit-log.md).

## When the owner leaves

If the owner's account is deactivated, or the owner leaves the organization of the space, the content has no active owner. It keeps the former owner's name, and:

- The space admins get a notification with the number of items in their space that no longer have an owner.
- The content appears in the panel **Content without an owner** under **Space settings › Content › Pages and trash**, with the reason (deactivated, left the organization, or never had an owner). Space admins choose **Assign owner** there.
- Organization administrators see the same list for all spaces they can read under **Settings › Organization › Content › Pages and trash**. Confidential spaces are not listed there; their space admins assign owners in the space.

Items you cannot open are counted but not listed. Someone who has access to them, or a space admin who can open them, assigns their owner.

If the person comes back, for example their account is activated again, they own the content again, unless someone was assigned in the meantime.

Content in the trash, archived content and content of archived or deleted spaces is not listed.
