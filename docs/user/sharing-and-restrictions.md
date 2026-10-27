# Sharing and restrictions

A space gives its members a role for every page in it (see [Spaces and pages](spaces-and-pages.md)). On a single page you can go further: share it with people and groups who are not in the space, create a share link, or restrict who can view or edit it. Pages, blog posts and whiteboards are shared the same way.

Everything on this page happens in the **Share** dialog of a page. It opens from the **Share** button of the page and has two tabs: **People and access** and **Share links**. Anyone who can edit a page can share it.

## Share a page with people or groups

1. Open the page and select **Share**.
2. Under **Add people or groups**, search by name or e-mail address and pick a person or a group.
3. Under **Access**, choose **Can read**, **Can comment** or **Can edit**.
4. To give the same access to every page below, turn on **Also the pages below**.
5. Select **Share** and confirm with **Share page**.

The person gets a notification (see [Notifications](notifications.md)). People outside the space see only what you share with them, not the space itself. A group must belong to the organization of the page; its members get the access as long as they are in the group.

Rules:

- **Also the pages below** needs your own role in the space to cover the chosen access on every page below. If it does not, share only this page, choose a lower access, or ask a space admin.
- You cannot change or remove access that you hold yourself, directly or through one of your groups. Ask someone else who can share the page.
- To change or remove an entry, use the access menu next to it under **Who has access**: change the access, change the pages it covers, or **Remove access**.

**Why does someone have access?** at the end of the tab explains, for a person you search, which role, share or link gives them access, and what limits it (a restriction, an unpublished page, the trash, an inactive account).

## Invite a guest

If the person has no account in the organization, you can invite them by e-mail:

1. In the **Share** dialog, turn on **Invite a guest by e-mail**.
2. Enter the address, choose the access and select **Send invitation**.

The person joins the organization as a guest and sees the page after accepting. If at that moment you may no longer share the page, the share is not created; it becomes an access request for the people who manage the page.

Organization administrators can always invite guests. Other people can do it only when the organization turns on **Members can invite guests to a page** (default off) under **Settings › Organization › Content › Pages and trash**, section **Sharing**. In a [confidential space](confidential-spaces.md), only its space admins invite guests or share pages with guests, and organization administrators cannot.

## Share links

A share link lets people open one page without being added to the access list. It gives read access to that page only, not to the pages below, the tree or the space.

1. In the **Share** dialog, open **Share links** and select **Create link**.
2. Under **Who can open it**, choose one of:
   - **Only the people and groups you choose** (up to 100 people or groups; they sign in to open it, even when they are not in the space)
   - **Signed-in members of the organization** (not for pages of personal spaces)
   - **Everyone signed in to this instance** (includes people of other organizations on the instance)
   - **Anyone with the link, without signing in** (only when the organization allows it)
3. Optional: set **Expires on**. The link stops working at the end of that day.
4. Optional: set a **Password** (up to 200 characters). Visitors enter it before the page opens; tell it to them on another channel.
5. Select **Create link** and copy the address.

Signed-in people who open a link appear under **Who has access** as **Via link**, with the date they last opened it. A view restriction still applies: if the page or a page above restricts viewing, only people on that access list can open it through a link.

Links for anyone without signing in:

- Visitors see only this page, without the tree, comments or other pages.
- Every such link needs an expiry date, at most **Longest lifetime of a link for anyone** days ahead (default 30).
- A page with a view restriction, on itself or above, cannot get such a link.

To change a link, select **Change** next to it. To end it, select **Revoke** and confirm with **Revoke link**: the address stops working at once, and people who opened the page only through this link lose access.

### Link settings

The organization sets these under **Settings › Organization › Content › Pages and trash**, section **Sharing**. Links for anyone and their lifetime can also be set for the whole instance; an organization can only shorten the lifetime.

| Setting | Default | Effect |
|---|---|---|
| **Share links** | on | Off: no new links, and existing links stop working. Sharing with people still works. |
| **Links for anyone without signing in** | off | Allows links that open without signing in. |
| **Longest lifetime of a link for anyone** | 30 days | 1 to 3650 days. |

## Restrict viewing or editing

A restriction limits a page to the people and groups on its access list, even if the space gives others a role.

1. In the **Share** dialog, under **Restrict access**, select **Change**.
2. Under **Who can view this page**, choose **Only the people and groups on the list**, or under **Who can edit this page**, choose **Only entries on the list with "Can edit"**.
3. Confirm with **Restrict**.

You are added to the list with **Can edit**, so you keep access. Add the other people and groups as described in [Share a page with people or groups](#share-a-page-with-people-or-groups). A restriction always needs at least one person or group on the list who can view (or edit) the page.

- **View restriction**: only people on the list can see the page and every page below it. For everyone else the page disappears from search, links and lists.
- **Edit restriction**: only list entries with **Can edit** can edit this page. Others who can read the page still read it. It does not apply to the pages below.

To lift a restriction, choose **Everyone who can view the space** or **Everyone who can edit in the space** and confirm with **Remove restriction**.

Pages imported from Confluence can list extra people under **Also named in the restrictions**. They pass the restriction but get no access from it; to open the page they need a role in the space.

### Restrictions in the page tree

- A view restriction on a page applies to all pages below it. A page below shows **A page above is restricted**; only people on the list of that page can see it, whatever is set below.
- A restriction set further down adds to the one above. To see a page, a person must be on the list of every view-restricted page above it and of the page itself.
- Space admins are not exempt. They see restricted pages only if they are on the list.

### Restricted pages in the space settings

Space admins find every restricted page of the space in the space settings, tab **Access**, panel **Restricted pages**. They see the titles but not the content, and can select **Remove restriction**. The removal is recorded in the [audit log](../admin/audit-log.md).

When nobody on the list of a restriction is active anymore (accounts deactivated or memberships ended), the space admins get a notification and the page is marked **Nobody on the list is active**.

## Moving pages

Shares, links and restrictions belong to the page and move with it. What the page inherits changes with the new place:

- View restrictions of the old pages above no longer apply; those of the new pages above do.
- Shares with **Also the pages below** on the old pages above no longer reach it; those on the new pages above do.
- In another space, the roles of that space apply.

When a move changes who can open or edit the content, the move dialog shows **How access changes**: who gains and who loses access. Confirm with **Move and change access**. If access changes again before you confirm, the dialog asks you to check the list and move again.

Moving content into a [confidential space](confidential-spaces.md) is refused while any of the pages is shared with groups, has groups on a restriction list, or has a link that is not limited to named people.

## Access requests

People who open a page or space they cannot see can ask for access:

1. On the page that says **This page does not exist or you have no access**, optionally write a message (up to 1000 characters) and select **Request access**.
2. For a space that its admins made findable, select **Ask to join**.

The request goes to the space admins and, for a page, to the people who set a restriction on it or above. They get a notification that opens the request; space admins also find open requests in the space settings, tab **Access**, panel **Access requests**. Approving a page request shares the page with the chosen access (optionally also the pages below); approving a space request gives a role in the space. The requester gets a notification either way.

Open requests close by themselves when the person gets access another way. You see your own requests under **Your access requests** and can **Withdraw** an open one. A person can send at most 30 requests a day.

## Giving access to a space

Space admins can use **Give access** in the space settings, tab **Access**, to give a person or group a role in the whole space, on one page, or on a page and the pages below. The assistant shows how many pages they can then read and edit before anything changes; restricted pages stay hidden unless the person is on their list.
