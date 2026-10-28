# Spaces and pages

Content lives in spaces. A space belongs to one organization and holds a tree of pages, folders, links and whiteboards. Every standard space has an overview page, created together with the space; opening the space opens it. A space can also be created as a knowledge base, which holds articles in areas and topics; see [Knowledge bases](knowledge-bases.md).

The rules your organization sets for spaces, such as who may create them and what happens to personal spaces of people who leave, are described in [Spaces for administrators](../admin/spaces.md).

## Spaces

A space has a name, an optional description and a key of 2 to 10 letters or digits. The key appears in the addresses of the space and its content, for example `/spaces/ITOPS/pages/1040/network-plan`; see [Content addresses](spaces-and-pages/content-addresses.md). Keys are unique regardless of case.

When a space admin changes the key, addresses with the old key keep leading to the space until another space takes that key. Links to pages always keep working, because the number in the address identifies the page.

### Who can read a space

Under **Who can read the space**, a space has one of three visibilities:

| Visibility | Readers |
|---|---|
| Private | Only the people and groups with a role in the space |
| Organization | Every member of the organization, plus the people and groups with a role. Guests and collaborators need a role. |
| Whole instance | Every internal user of the instance, in all organizations, plus the people and groups with a role |

Visibility grants reading only. Commenting, editing and managing always need a role.

A private space can be made findable: with **Members of the organization can find this space and ask to join**, members see its name and description in the list of spaces, but no pages, and can choose **Ask to join**. A space admin decides on the request.

### Roles

| Role | Allows |
|---|---|
| Reader | Read and export pages |
| Commenter | Also comment on pages |
| Editor | Also create, edit and move pages, folders and links |
| Space admin | Also manage the settings and permissions of the space |

Roles are given to people, groups, **All members of the organization** or **All internal users of the instance**. A person's role is the highest of all roles that reach them, including the reader role through visibility. Only active accounts count.

Every change of visibility or roles shows first who gets access, who loses access and who gets another role. People you may not see are counted but not named.

Two rules keep a space administered:

- A change that would leave the space without an active space admin is refused: "A space needs at least one space admin. Give someone else the space admin role first."
- Nobody can raise their own role, directly or through a group that includes them.

To give up your own role, choose **Step down as space admin** in the danger zone of **Permissions**. Another space admin must remain.

Pages inside a space can narrow access further with restrictions, and single pages can be shared with people outside the space; see [Sharing and restrictions](sharing-and-restrictions.md).

## Creating and managing your own space

### Creating a space

1. Open **Spaces** and choose **Create space**. The button is missing when your organization does not let members create spaces.
2. Choose the **Type of space**: **Standard space** for pages, folders, blog posts, meetings and whiteboards, or **Knowledge base** for articles. The type cannot be changed later.
3. Enter the **Name**. Lunedo suggests a **Key** from the name; change it if you like. The key must be 2 to 10 letters or digits and not used by another space.
4. Optionally add a **Description**.
5. Choose **Who can read the space**.
6. Check the **Permissions**. Your organization suggests roles for new spaces; change them as needed. You always become space admin.
7. Choose **Create space**.

To create a confidential space instead, for example for one-on-ones or a works council, turn on **Confidential space** in the same dialog, if your organization allows it. This cannot be changed later; see [Confidential spaces](sharing-and-restrictions/confidential-spaces.md).

### Space settings

Space admins open the settings from the space menu. The settings are grouped:

| Group | Page | What it holds |
|---|---|---|
| | **General** | Name, key, description and who can read the space |
| Access | **Permissions** | Who has which role |
| Access | **Access** | Give people access, decide on access requests, review restricted pages |
| Content | **Pages and trash** | Publish or live mode for new pages, trash periods, deleting the space |
| Content | **Page status** | The status values pages can have; see [Publishing and page status](spaces-and-pages/publishing-and-page-status.md) |
| Content | **Templates** | Templates of the space; see [Templates](templates.md) |
| Content | **Export** | Whether people may export; see [Export](export.md) |
| Connections | **Shortcuts** | Links to content people need often |
| Connections | **Chat channels** | Posts to Microsoft Teams, Slack, Discord, Matrix or a webhook; see [Notifications](notifications.md) |

Knowledge bases have additional pages for their portal; see [Knowledge bases](knowledge-bases.md).

### Deleting a space

**Delete space** in the danger zone of **Pages and trash** moves the space with all its pages to second-stage recovery. Type the name of the space to confirm. Nobody can open the space or its pages afterwards, and links to its pages stop working. The people who were space admins can restore it from **Deleted spaces** in the list of spaces until that period ends; organization administrators can too, unless the space is confidential. See [Trash and archive](spaces-and-pages/trash-and-archive.md) for the periods and for archiving a space instead.

## Your personal space

Every person with a standard account can have one personal space, unless the instance does not offer personal spaces.

- Open it with **My space** in the sidebar, or **My personal space** on the list of spaces. It is created the first time you open it, with an overview page.
- A personal space is always private. Share it by giving people and groups a role under **Permissions**.
- Its name is your name unless you set another one under **General**.
- You are its space admin and manage it like any other space.

When your account is deactivated, instance administrators can hand your personal space to one of the people who still have a role in it, or delete it; see [Spaces for administrators](../admin/spaces.md).

## The page tree

The sidebar of a space shows its page tree. A tree item is one of these:

- **Pages** hold content written in the editor.
- **Folders** hold other items and show them as a **List** or as **Tiles**, with an optional description. **Convert to folder** and **Convert to page** in the item's menu change the type without losing the children.
- **Links** point to a page, folder or whiteboard in any space, or to a web address. A link to an item the reader cannot open shows "No access", without the item's title.
- **Whiteboards** are canvases for drawing together; see [Whiteboards](whiteboards.md). They cannot contain other items.

Create items with **Create in this space** at the top of the tree, or with **New page inside**, **New folder inside**, **New link inside** and **New whiteboard inside** in the menu of an item.

### Moving items

Drag an item to its new place, or choose **Move…** in its menu and pick the space, the place below and the position. Children move along. A move by drag and drop can be undone for 5 seconds.

- Moving within a space needs the editor role; moving to another space needs the editor role in both spaces.
- When the new place gives other people access, because other roles or restrictions apply there, the dialog shows who gains or loses access and asks you to confirm.
- An item can never be moved below itself. When someone else moved the same item at the same moment, the move is refused and you try again, so two people moving items never break the tree.

Changes to the tree reach every open sidebar at once.

To duplicate an item instead, see [Copying](spaces-and-pages/copying.md). To delete or archive items, see [Trash and archive](spaces-and-pages/trash-and-archive.md).

### Keyboard

In the page tree, the arrow keys move between items and open and close levels, Home and End jump to the first and last item, and Shift+F10 or the context menu key opens the menu of the item. **Move…** in that menu moves an item without dragging.

## Pages

Readers see a rendered view of a page. People with the editor role switch to editing with **Edit** or the E key and finish with **Done**. Several people can edit a page at the same time; see [Editing together](collaboration.md). Whether changes go live at once or are published as versions depends on the page's mode; see [Publishing and page status](spaces-and-pages/publishing-and-page-status.md). Every block the editor offers is listed in [Blocks](blocks.md).

- **Labels:** a page can have up to 100 labels. Select a label to list the pages of the space with it, at `/spaces/<key>/labels/<label>`; **Everywhere** widens the list to all spaces.
- **Backlinks:** "Linked from 3 pages" lists the pages you can read that link to the page.
- **Page width:** **Use full width** and **Use fixed width** in the page menu change the width for everyone.
- **Number headings** in the page menu numbers the headings of the page; see [Embeds and blocks](blocks/embeds-and-blocks.md#numbered-headings).
- **Owner:** every page has an owner; see [Owners](spaces-and-pages/owners.md).
- **History:** the line "Edited by … on …" below the title opens the versions of the page.

Pages can also be exported ([Export](export.md)), copied ([Copying](spaces-and-pages/copying.md)), turned into templates ([Templates](templates.md)) and watched ([Notifications](notifications.md#watching)).
