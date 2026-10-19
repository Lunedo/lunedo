# Knowledge bases

A knowledge base is a space of the type **knowledge base**. It holds articles, such as how-tos and troubleshooting articles, sorted into categories. Authors write in the normal Pagehall interface with the same editor, versions, comments, permissions and search as in every other space. Readers use the **portal**, a lean site of its own without the navigation, page tree or editor of the app (see [The portal](#the-portal)).

## Creating a knowledge base

In the create dialog, choose **Knowledge base** as the type of space. The type cannot be changed later, and every existing space is a standard space.

- A knowledge base has no overview page. Its start page lists the articles by category.
- It cannot be confidential, and personal spaces are never knowledge bases.
- The creator becomes space admin. The dialog suggests no other roles for a knowledge base; add editors there or later under **Space settings → Permissions**. Who may edit is set with these roles; who may read is set with the audience.

Through the API, create it with `POST /api/v1/organizations/{organizationId}/spaces` and `"type": "knowledgeBase"`. The response of every space contains `type` and, for knowledge bases, `audience`.

## Who may read it

The audience of a knowledge base decides who reads it:

| Audience | Readers in Pagehall | Readers in the portal |
|---|---|---|
| Public | every internal user of the instance | everyone, also without signing in |
| All signed-in people (default) | every internal user of the instance | the same |
| Specific groups | members of the groups that hold the reader role, and holders of other roles | the same |
| Portal accounts | only holders of a role | portal accounts with a membership in the organization, and holders of a role |

Guests read a knowledge base only when they hold a role. Portal accounts read only knowledge bases: through a role in the space or the audience "Portal accounts", never through shares or links, and never in other spaces, whatever their roles say.

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

An article has a type: **How-to**, **Troubleshooting** or none. A template sets it when the article is created; authors change it at the top of the article or with `PUT /api/v1/articles/{itemId}/type`. Readers filter by type in the portal. Templates of a knowledge base set the type in the template editor (**Space settings → Templates**) or with `articleType` in the template API.

The gallery of a knowledge base asks for the title of the new article. Left empty, the article gets the title of the template.

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

Under **Space settings → Categories**, editors set the icon and the introduction of a category and change the order of categories. The portal shows the categories in this order. Without an icon, it shows the name when it has at most three characters, otherwise its first letter.

Each category can have a contact address, which readers use when an article did not help. A subcategory without its own address uses the address of its category; a category without one uses the address of the knowledge base. Space admins set the addresses. Pagehall sends nothing itself and creates no tickets.

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

## The portal

Readers open a knowledge base in its portal: a start page with the search and the categories, a page per category, the articles, the search and a contact page. The portal has no navigation, page tree, editor, notifications or settings of the app, and follows the light or dark mode of the reader's system. Which one people see depends only on the address they open; nobody is redirected between portal and app.

### Addresses

- Every knowledge base has a portal at `/help/<path>/` on the instance. The path is the space key in lowercase until a space admin changes it under **Space settings → Address**. A changed path keeps redirecting old links (301) to the new one. An old path stays reserved for the organization: only a knowledge base of the same organization can take it over.
- Articles have the address `<number>-<short form of the title>`, for example `/help/help/12-set-up-the-vpn-connection`. An old short form or the bare number redirects to the current address. A number of an article that moved to another knowledge base redirects there. Categories are at `topics/<id>`, the search at `search?q=…`.
- An unknown address, a hidden article and an article that does not exist look exactly the same: "We can't find this page", status 404.
- The change of a path or domain is recorded in the audit log as `knowledgeBase.portalAddressChanged`.

### Own domains

A knowledge base can have its own domain, for example the address of an older help center.

1. An instance administrator allows the domain for one organization under **Instance settings → Knowledge base portals** (`POST /api/v1/instance/portal-domains`). Allowing and removing are recorded in the audit log (`organization.portalDomainAllowed`, `organization.portalDomainRemoved`).
2. The DNS record of the domain points to the instance, and the reverse proxy sends the domain to Pagehall and holds its certificate. Pagehall does not request certificates itself. Portals on own domains need HTTPS.
3. A space admin chooses the domain under **Space settings → Address**. The page shows the DNS record to copy before saving.

On its own domain only the portal answers; the app and `/api/` are not reachable there. The portal keeps working under `/help/<path>/` on the instance as well.

### Signing in

- Under `/help/<path>/` the portal uses the session of the app.
- Anonymous visitors of a knowledge base that is not public see the sign-in page of the portal on every address, with one button per identity provider of the instance and "Sign in with an e-mail address", which leads to the normal sign-in and back to the requested address.
- On an own domain the portal has a session of its own. A visitor without one is sent to the instance; when they are already signed in there, they come back at once with a session for the domain, otherwise they sign in first. The handoff uses a one-time code that is valid for 60 seconds, bound to the domain and to a random value in a cookie of the domain, and can be used once. The cookie of the domain (`__Host-pagehall-portal`) is host-only, `Secure`, `HttpOnly` and `SameSite=Lax`.
- The session of a domain belongs to the session of the instance. Signing out in the portal signs out everywhere; when the instance session ends (sign-out, expiry, deactivation, "sign out everywhere"), the session of the domain ends too.
- Requests that change something in the portal (rating, notes, sign-out) must come from the portal's own origin.

### Who sees what

- The portal shows only published versions. Drafts and articles that were never published are not shown, also not to editors.
- Category lists and article counts are computed for each reader from the search index. A category the reader cannot read, and every article in it, is neither shown nor counted.
- People who may edit an article see **Edit**, which opens the article in the editor of the app. In the app, **View in portal** opens the knowledge base and, on a published article, the article in the portal.
- The account menu shows the name, the e-mail address, a link to the app and **Sign out**. The link to the app appears only for people who can see at least one space and never for portal accounts. Its name is set by instance administrators under **Instance settings → Knowledge base portals**; empty means "Go to the wiki".
- Frequent searches on the start page are the most searched terms of the last 90 days that had results, each searched at least three times. A reader sees only terms with which they find something themselves.

### Contact

- "Didn't help? Write to us" under an article opens the reader's mail program with the contact address of the article's category (inherited from the category above, then from the knowledge base), the article title as subject and the link to the article in the body. "Copy address" helps readers without a mail program.
- On a search without results, and on the contact page, the reader chooses the area: each top-level category with a contact address, and "Something else" for the address of the knowledge base.
- Pagehall sends nothing itself and creates no tickets.

### Appearance

Space admins set the appearance under **Space settings → Appearance and start page**. Changes apply at once.

- **Logo**: PNG, JPEG or WebP up to 256 KiB. Without one, the portal shows the organization's logo or the first letter of its name.
- **Brand color**: a color of the fixed palette, or an own color for light and dark mode. An own color must reach a contrast of 4.5:1 as text on the background and for text on it, in both modes. Otherwise Pagehall proposes the nearest shade that passes and saves it only after confirmation (`brandContrast` with `light` and `dark`, then `confirmProposal`).
- **Start page**: heading and a short text above the search.
- **Categories in the top bar**: the top bar shows up to five categories in their order and the rest under "All topics". From the set number of categories on (default 10), it shows only "Topics" with a menu of all categories.
- **"Provided with Pagehall"** in the footer, on by default.
- **Notes of readers** are kept for 1 to 60 months (default 12). Shortening the period deletes older notes at once, after confirmation.

The help icon of the app can open a knowledge base of the organization instead of the Pagehall documentation: **Organization settings → General → Help**. Only knowledge bases that everyone signed in may read can be chosen.

API: `GET /api/v1/spaces/{spaceId}/knowledge-base/portal`, `PUT …/portal/address`, `PUT …/portal/appearance`, `PUT` and `DELETE …/portal/logo`, `GET …/portal/domains`; `GET` and `PUT /api/v1/organizations/{organizationId}/help`.

### Pre-rendered articles

The content of an article is rendered to HTML once per published version and language and stored; publishing queues the rendering, and a missing rendering is made on first read. Permissions are checked on every request before the stored HTML is served. Content that depends on the reader is left out of the portal: included pages, child page lists and reports are not shown, links to pages outside the knowledge base show "No access" without their title, and mentions name only members of the organization.

## Reader statistics

The portal records what readers do, without any account, session or address. No table below has a column for one, and nothing is derived from the reader. M9.3 builds the statistics screens on this data.

| Table | One row per | Columns |
|---|---|---|
| `portal_searches` | search | `space_id`, `term` (trimmed, lowercase, at most 200 characters), `results`, `zero_results` (generated: `results = 0`), `category_id` of a category filter or null, `searched_at` (to the hour) |
| `portal_article_views` | article and day | `item_id`, `space_id`, `day`, `views` |
| `portal_ratings` | article and day | `item_id`, `space_id`, `day`, `helpful`, `unhelpful` |
| `portal_feedback` | note after "No" | `id`, `item_id`, `space_id`, `day`, `text` (at most 2,000 characters) |

- Searches are recorded on the first page of results; each device counts at most 60 searches in ten minutes. Article views are counted when an article page is served.
- "Was this helpful?" records yes or no; a note after "No" is stored separately. Double votes are prevented only in the browser.
- A note is deleted when the retention of its knowledge base ends for it: each note gets a job that runs on its day of deletion and checks the current retention, so a longer retention moves the job and a shorter one deletes older notes at once. A daily sweep deletes notes whose job was lost.
- Rows of an article or knowledge base go when it is deleted permanently.

The read interface is `PortalStatistics` in `@pagehall/server` (`services.portalStatistics`). Periods are `{ from, to }` with ISO dates, both included. It does not check permissions; the routes that use it decide who may read the statistics.

| Method | Returns |
|---|---|
| `views(spaceId, period)` | article views per day |
| `articleViews(spaceId, period, limit?)` | most viewed articles with their counts |
| `searches(spaceId, period)` | number of searches and of searches without results |
| `topTerms(spaceId, period, { limit, minimum })` | most frequent terms with searches, searches without results and the last search; only terms searched at least `minimum` times (default 3) |
| `zeroResultTerms(spaceId, period, { limit, minimum })` | the same for searches without results |
| `ratings(spaceId, period, itemId?)` | helpful and not helpful per article |
| `feedback(spaceId, { itemId, limit, before })` | notes, newest first, without any personal reference |
| `frequentSearches(spaceId, limit?)` | terms for the start page |
