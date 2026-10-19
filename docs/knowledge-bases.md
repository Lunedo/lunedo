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
