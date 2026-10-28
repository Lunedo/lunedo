# Publishing and page status

Every page uses one of two modes. In **publish mode**, readers see the last published version while editors work on a draft. In **live mode**, readers see every change at once. Independently of the mode, a page can carry a **page status** that tells readers how far it is, for example "In progress" or "Verified".

## Publish mode and live mode

| | Publish mode | Live mode |
|---|---|---|
| What readers see | The last published version | The current content, while it is being edited |
| Draft | Changes collect in a draft that only editors see | No draft |
| Versions | Each publication creates a version | A version is created after a pause without changes, or when the last person editing leaves |
| A new page | Only editors see it until someone publishes it | Readers see it at once |

Both modes save every change as you type; see [Collaboration](../collaboration.md).

### Who chooses the mode

- **New pages** get the mode from the setting **Default mode of new pages** (default: Publish mode). Organization admins set it in **Settings › Organization › Content › Pages and trash**, space admins in **Space settings › Content › Pages and trash**. The organization can lock it so spaces cannot deviate.
- **Each page** can deviate from the default. Anyone who may edit the page switches it in the page menu with **Switch to live mode** or **Switch to publish mode**.
- **Blog posts** always use publish mode; see [Blog](../blog.md).
- **Knowledge base articles** always use publish mode, and the page menu offers no switch. A page in live mode must be switched to publish mode before it can be moved into a knowledge base. See [Knowledge bases](../knowledge-bases.md).

The setting **Version after a pause in live mode** (default 10 minutes, 1 minute to 24 hours) sets how long a live page must stay unchanged before it gets a version. It sits next to the default mode and can also be set per organization and per space.

### Publish a page

1. Edit the page. The editor shows **Saved to draft**, and the page header shows how many changes the draft has since the published version.
2. Select **Publish** (first publication) or **Update** (later publications).
3. Optional: describe the change in **What changed?**, up to 500 characters. For later publications, open this field with **Update with a change note …** next to **Update**. The note appears in the version history.

Publishing a draft without changes creates no new version. A page below a page that was never published stays hidden from readers until that page is published too; the publish dialog says so. Publishing a page publishes only that page.

### Work with the draft

- **See the difference.** Editors who open a page with a draft see the published version with a banner that names the unpublished changes. **Open draft** shows the draft; the **View** switch changes between **Published** and the draft with changes marked.
- **Discard the draft.** **Discard draft** in the page menu returns the draft to the published version for everyone editing. Discarded drafts are kept for 30 days and can be brought back with **Restore as draft** under **Discarded drafts** in the version history.
- **Restore an old version.** In publish mode, restoring a version makes it the draft; publish it to show it to readers. In live mode, restoring creates a new version at once.

### Switch modes

- **To publish mode:** the current content becomes the published version. Changes from then on stay in the draft.
- **To live mode:** if the draft has unpublished changes, or the page was never published, Lunedo asks first, because readers see the draft at once. Choose **Switch and show the draft**, or **Keep publish mode** and publish or discard the draft first.

### Who may publish

Publishing, switching the mode and restoring versions need the editor role in the space and edit access to the page. A view or edit restriction narrows this; see [Sharing and restrictions](../sharing-and-restrictions.md). Viewing the draft needs edit access too. API tokens can be limited to writing drafts; a person then publishes in Lunedo.

## Page status

### Values

Each space has its own list of status values. A new space starts with four:

| Value | Color |
|---|---|
| Rough draft | Gray |
| In progress | Blue |
| Ready for review | Orange |
| Verified | Green |

Space admins manage the list in **Space settings › Content › Page status**:

- Add values with a name of 1 to 40 characters and a color (Gray, Accent color, Blue, Green, Orange, Red). A space holds up to 20 values, and names must differ.
- Rename or recolor a value. The change applies to every page that has it.
- Change the order. Editors see the values in this order.
- Remove a value. Lunedo names how many pages lose the status; their status is not replaced by another value.

The setting **Page status** on the same screen turns the feature on or off for the space (default on). Turning it off hides the status everywhere; pages keep their status in case you turn it on again.

### Set the status of a page

1. Open the page.
2. Select the status badge at the top of the page, or **Change the status** in the page menu.
3. Choose a value, or **Remove status**.

Anyone who may edit the page can set its status. Only pages have a status; folders, blog posts and other content do not.

### Where the status shows

- **At the top of the page** for everyone who can read it.
- **In search results**, next to each page.
- **In the Status and owner section** of the page's versions screen, with who changed the status and when.
- **In notifications** to people who watch the page; see [Notifications](../notifications.md#watching).

When a page moves to another space, it keeps a status with the same built-in value or the same name in the target space. Otherwise the status is removed.

### Find pages by status

On the search page, use the filter **Page status**, or type the operator `status:` in the search box, for example `status:verified`. A name with spaces goes in quotes, for example `status:"ready for review"`. Spaces with the page status turned off are not matched.
