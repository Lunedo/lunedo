# Knowledge bases

A knowledge base is a space of the type **knowledge base**. It holds articles, such as how-tos and troubleshooting articles, sorted into categories. Authors write in the normal Pagehall interface with the same editor, versions, comments, permissions and search as in every other space. A separate portal for readers follows in a later version; until then, readers open articles in Pagehall.

## Creating a knowledge base

In the create dialog, choose **Knowledge base** as the type of space. The type cannot be changed later, and every existing space is a standard space.

- A knowledge base has no overview page. Its start page lists the articles by category.
- It cannot be confidential, and personal spaces are never knowledge bases.
- The creator becomes space admin, and the other roles come from the dialog as for every space. Who may edit is set with these roles; who may read is set with the audience.

Through the API, create it with `POST /api/v1/organizations/{organizationId}/spaces` and `"type": "knowledgeBase"`. The response of every space contains `type` and, for knowledge bases, `audience`.

## Who may read it

The audience of a knowledge base decides who reads it:

| Audience | Readers in Pagehall | Later in the portal |
|---|---|---|
| Public | every internal user of the instance | also visitors without an account |
| All signed-in people (default) | every internal user of the instance | the same |
| Specific groups | members of the groups that hold the reader role, and holders of other roles | the same |
| Portal accounts | only holders of a role | portal accounts |

Guests read a knowledge base only when they hold a role. Portal accounts never read internal spaces.

Categories and articles can narrow the audience with view restrictions, as pages can in every space. They can never widen it. Shares of single articles and share links work as in every other space.

Space admins change the audience under **Space settings → Visibility**. The change is saved with **Save visibility**. A change that lets more people read, for example from groups to all signed-in people or to public, or adding a group, asks for confirmation first and names the number of articles without a view restriction that become readable. Narrowing saves without asking. Every change is recorded in the audit log as `knowledgeBase.audienceChanged`, with the old and new audience, the groups, whether it widened and the number of articles; the reader roles of groups are recorded as permission changes.

API: `GET /api/v1/spaces/{spaceId}/knowledge-base`, `POST …/knowledge-base/audience/preview` and `PUT …/knowledge-base/audience` with `confirmWidening`. Without the confirmation, a widening change is refused with `audienceWidening`. The ordinary visibility route of a space refuses knowledge bases with `knowledgeBaseVisibility`.

## Content

A knowledge base contains only articles and categories:

- **Articles** are pages. They always use publish mode: readers see the last published version while authors work on a draft. Live mode is not offered.
- **Categories** are folders. A folder at the top level is a category, a folder inside a category is a subcategory. Deeper folders belong to their subcategory.
- Articles are placed in categories or at the top level, never below another article. Articles and categories keep their kind; they cannot be converted.

Blog posts, meeting series, whiteboards and links are refused, through the interface, the API, moves, copies and every other path, with `knowledgeBaseContent`. A page in live mode or a page with subpages cannot be moved or copied into a knowledge base (`knowledgeBaseMode`, `knowledgeBasePlacement`); switch it to publish mode or move its subpages first.

## Articles

### Article type

An article has a type: **How-to**, **Troubleshooting** or none. A template sets it when the article is created; authors change it at the top of the article or with `PUT /api/v1/articles/{itemId}/type`. Readers will filter by type in the portal.

### Templates and sections

Two article templates ship with Pagehall, in English and German:

| Template | Sections |
|---|---|
| How-to (Anleitung) | What this is about, Before you start, Steps, Did it not work? |
| Troubleshooting (Störung) | What you see, Cause, Solution |

The sections are semantic: their key (`summary`, `prerequisites`, `steps`, `help`, `symptom`, `cause`, `resolution`) keeps its meaning in every language and is used by search, the API and later by the portal. A section of a template can carry an icon. In a knowledge base, the template gallery offers the article templates and the templates of the knowledge base itself; the general templates of the instance and organization are offered in standard spaces. Writing without a template is always possible.

Space admins can make sections required under **Space settings → Article templates**. Nothing is required by default. While a required section of an article is empty or missing, publishing is refused with `requiredSectionsEmpty`; the editor marks the section and puts the cursor into it. A section counts as filled when it has text, an image or another block; template hints do not count. Articles that are already published stay published.

### Screenshots

Images in the sections **Steps**, **What you see** and **Solution** are framed by default. Authors switch the frame off, or on for an image elsewhere, with the frame menu of the selected image. The setting is stored as the `frame` attribute of the image.

### Addresses

Every article gets a number when it is created or moved into the knowledge base. The number is unique within the knowledge base, never reused, and stays when the article moves within it. The address of an article is the number followed by a short form of its title, such as `123-vpn-verbindung-einrichten`. When the published title changes, the old short forms are kept so that old addresses can be redirected. An article moved into another knowledge base gets a number there; its old number keeps pointing to it.

## Categories

Under **Space settings → Categories**, editors set the icon and the introduction of a category and change the order of categories. Without an icon, the portal shows the first letter of the name.

Each category can have a contact address, which readers will use when an article did not help. A subcategory without its own address uses the address of its category; a category without one uses the address of the knowledge base. Space admins set the addresses. Pagehall sends nothing itself and creates no tickets.

API: `GET /api/v1/spaces/{spaceId}/categories`, `PUT /api/v1/categories/{itemId}` for the icon, `PUT /api/v1/categories/{itemId}/contact` and `PUT /api/v1/spaces/{spaceId}/knowledge-base/contact`. Title, introduction and order change like for every folder.

## Articles through the API

Scripts can migrate existing articles. With an API token of a person or service account that may edit the knowledge base:

1. Create categories: `POST /api/v1/spaces/{spaceId}/items` with `"kind": "folder"`.
2. Create the article in its category: `POST /api/v1/spaces/{spaceId}/items` with `"kind": "page"`, `"parentId"` of the category and `"articleType"`.
3. Upload images: `POST /api/v1/pages/{pageId}/attachments?name=…`.
4. Store the content with sections and images: `PUT /api/v1/pages/{pageId}/content`, with `section` blocks (`key`, `title`, optional `icon`) and `image` blocks that reference the uploaded attachments.
5. Publish: `POST /api/v1/pages/{pageId}/publish`.

`GET /api/v1/spaces/{spaceId}/articles` lists the articles a caller can read, newest change first, optionally of one category (`categoryId`), outside every category (`topLevel=true`) or of one type. `GET /api/v1/articles/{itemId}` returns the published version of an article with its number, short form, category path, contact address and its sections, each with key, title, icon, plain text and ProseMirror content; editors get the draft with `draft=true`.

## Review

Articles get outdated. A knowledge base can ask for regular reviews, so that someone checks each article from time to time.

### Intervals

Space admins set the review interval under **Space settings → Review**: no review (default), every 3, 6 or 12 months. It applies to every article without an interval of its own. Editors give an article its own interval, or switch reviews off for it, at the top of the article next to **Review**; choosing **Same as the knowledge base** returns to the interval of the knowledge base. There is no interval per category.

An article is due when its interval has passed since its last review, or since it was first published when it was never reviewed. Unpublished articles are never due. Changing an interval, reviewing an article, moving it into or out of a knowledge base and publishing it for the first time update the due date at once.

### Reminders

The owner of an article is reminded when it becomes due, and once before, by default 14 days earlier. The reminders arrive through the notification channels as **Article reviews** and can be changed there like every other notification. Under **Space settings → Review**, space admins choose:

- **First reminder**: only on the due date, or 7, 14 or 30 days before.
- **Who is reminded**: the owner, or the owner and the space admins. Articles without an owner, for example because the owner's account was deactivated, are always reminded to the space admins.

Each reminder is scheduled for the moment it is due when the due date is set, and moved when the due date changes. A reminder is sent at most once per due date. An hourly check only catches up reminders whose job was lost, for example after an outage.

### Review list

**Review** in the sidebar of the knowledge base lists the articles that are due or overdue, due within 30 days, whose source page changed, or that have no owner. Everyone with edit rights in the knowledge base sees it, each person only with the articles they may edit. The list shows title, category, owner, interval, last review and the state, both as text and as a ring that fills up as the interval passes. Filters show due articles, articles due within 30 days or articles without an owner, and **Only my articles** shows the articles you own.

Articles without an owner show **Set owner** to space admins, who choose a person with edit rights by name. When an owner's account is deactivated, the space admins are notified, as for every space.

### Marking as reviewed

Anyone with edit rights marks an article as reviewed, in the review list, on **For you** or at the top of the article. The review is recorded in the article's history with who and when, without a new version, and the next due date starts from now. For a few seconds the review can be undone. Every review and every undo is recorded in the audit log as `article.reviewed` and `article.reviewUndone`.

When an author publishes a changed article and ticks **Content reviewed** in the publish dialog, the publication also counts as a review. The box is not ticked by default.

### For you

**For you** shows **Due for review** with the articles you own that are due within 30 days or whose source page changed, with **Mark as reviewed** for each. The section appears only when something is due.

## Source pages

An article can be based on internal pages, for example the operating documentation of a service. Editors link them at the top of the article under **Source pages** by searching for a page by title. A source page must be a page in a space of the same organization that is neither a knowledge base nor confidential, and the editor must be able to read it. An article has at most 20 source pages.

When a source page is published with changes, the article shows **Source page changed** in the review list until it is marked as reviewed, and its owner is notified once. Live pages count each saved version as a change. The notification and the review list name the article, never the source page.

In Pagehall, the link to a source page and its title are shown only to people who can read the source page; for everyone else the source does not exist. The portal for readers never shows source pages, and they are not part of the article's content or its machine-readable form. Linking and removing a source page is audited as `article.sourceAdded` and `article.sourceRemoved`.

## Reviews through the API

| Route | Permission | Purpose |
|---|---|---|
| `GET /api/v1/spaces/{spaceId}/knowledge-base/reviews` | read the knowledge base | interval, lead time and recipients |
| `PUT /api/v1/spaces/{spaceId}/knowledge-base/reviews` | space admin | change them |
| `GET /api/v1/spaces/{spaceId}/reviews` | read the knowledge base | review list with `filter` and `mine`, only editable articles |
| `GET /api/v1/reviews/mine` | signed in | the caller's due articles |
| `GET /api/v1/articles/{itemId}/review` | read the article | interval, last review and due date |
| `PUT /api/v1/articles/{itemId}/review/interval` | edit the article | own interval, `0` for none or `null` to inherit |
| `POST /api/v1/articles/{itemId}/reviews` | edit the article | mark as reviewed |
| `DELETE /api/v1/articles/{itemId}/reviews/{reviewId}` | edit the article | undo the latest own review within two minutes |
| `GET`, `POST /api/v1/articles/{itemId}/sources`, `DELETE …/sources/{sourceId}` | read, edit the article | source pages the caller can read |

`POST /api/v1/pages/{pageId}/publish` accepts `"reviewed": true` for articles. Reviews also appear in `GET /api/v1/items/{itemId}/activity` with the type `review`.

`GET /api/v1/articles/{itemId}/review` gives the date readers see as "last reviewed": `reviewedAt`, or `publishedAt` when the article was never reviewed. Show it only while `effectiveIntervalMonths` is set; without reviews, show the date of the last change instead.
