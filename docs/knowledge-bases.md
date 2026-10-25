# Knowledge bases

A knowledge base is a space of the type **knowledge base**. It holds articles, such as how-tos and troubleshooting articles, sorted into areas and topics. Authors write in the normal Lunedo interface with the same editor, versions, comments, permissions and search as in every other space. Readers use the **portal**, a lean site of its own without the navigation, page tree or editor of the app (see [The portal](#the-portal)).

## Creating a knowledge base

In the create dialog, choose **Knowledge base** as the type of space. The type cannot be changed later, and every existing space is a standard space.

- A knowledge base has no overview page. Its start page lists the articles by area.
- It cannot be confidential, and personal spaces are never knowledge bases.
- The creator becomes space admin. The dialog suggests no other roles for a knowledge base; add editors there or later under **Space settings → Permissions**. Who may edit is set with these roles; who may read is set with the audience.

Through the API, create it with `POST /api/v1/organizations/{organizationId}/spaces` and `"type": "knowledgeBase"`. The response of every space contains `type` and, for knowledge bases, `audience`.

## Who may read it

The audience of a knowledge base decides who reads it:

| Audience | Readers in Lunedo | Readers in the portal |
|---|---|---|
| Public | every internal user of the instance | everyone, also without signing in |
| All signed-in people (default) | every internal user of the instance | the same |
| Specific groups | members of the groups that hold the reader role, and holders of other roles | the same |
| Portal accounts | only holders of a role | portal accounts with a membership in the organization, and holders of a role |

Guests read a knowledge base only when they hold a role. Portal accounts (see below) read only knowledge bases: through a role in the space or the audience "Portal accounts", never through shares or links, and never in other spaces, whatever their roles say.

### Portal accounts

Portal accounts are for readers without an account of the organization, for example customers. People who may manage the organization's members (organization owners and administrators, or a custom role with **Members and groups: manage**) invite them for a knowledge base whose audience is "Portal accounts" under **Space settings → Portal accounts** by e-mail address, optionally with a date when the access ends. Being space admin of the knowledge base is not enough, because a portal account joins the organization.

- The invitation e-mail links to a page where the reader chooses a name and a password; afterwards the link leads to the portal. The link works once and for 7 days. An open invitation can be withdrawn there. A portal invitation replaces only an earlier portal invitation for the same address and knowledge base; open member invitations stay valid.
- A portal account signs in with its e-mail address and password, and can add a passkey and an authenticator app on its own page. It reads the portals of the knowledge bases it was invited to, and of knowledge bases where it holds a role, never every knowledge base of the organization. It never sees the wiki: the API answers every other request of a portal account with `portalAccountOnly`, and opening the wiki shows only the list of its portals and its sign-in settings.
- Portal accounts only read. A role above Reader for a portal account is refused (`portalAccountReaderOnly`), and a higher role through a group counts as Reader for it, in the API, the collaboration server and every other path.
- An address that already belongs to another Lunedo account cannot accept the invitation (`portalInvitationAccountExists`); give that account a role instead.
- The person who invites is responsible for the account and is reminded before its access ends, like for guests. When the date is reached, the access ends and the account no longer reads the organization's knowledge bases.
- The list shows the portal accounts invited to this knowledge base. From there an account can be **deactivated**, which ends its sessions and blocks its sign-in, or **removed** from the organization. Organization administrators can do the same in the member list. An account that also reads knowledge bases of other organizations can only be removed, not deactivated, from one organization.
- Invitations are recorded in the audit log as `invitation.created` and `portalAccount.invited`, acceptances as `invitation.accepted` and `account.created`, the end of access as `membership.removed` with the reason `expired` or `removed`, and deactivation as `account.deactivated`.

API: `GET` and `POST /api/v1/spaces/{spaceId}/portal-accounts`, `DELETE /api/v1/spaces/{spaceId}/portal-invitations/{invitationId}`, `POST /api/v1/spaces/{spaceId}/portal-accounts/{accountId}/deactivate` and `DELETE /api/v1/spaces/{spaceId}/portal-accounts/{accountId}`, all with the permission to manage the organization's members; `GET /api/v1/account/portals` for the portal account itself.

Areas, topics and articles can narrow the audience with view restrictions, as pages can in every space. They can never widen it. Shares of single articles and share links work as in every other space.

Space admins change the audience under **Space settings → Visibility**. The change is saved with **Save visibility**. A change that lets more people read, for example from groups to all signed-in people or to public, or adding a group, asks for confirmation first and names the number of articles without a view restriction that become readable. Narrowing saves without asking. Every change is recorded in the audit log as `knowledgeBase.audienceChanged`, with the old and new audience, the groups, whether it widened and the number of articles; the reader roles of groups are recorded as permission changes.

API: `GET /api/v1/spaces/{spaceId}/knowledge-base`, `POST …/knowledge-base/audience/preview` and `PUT …/knowledge-base/audience` with `confirmWidening`. Without the confirmation, a widening change is refused with `audienceWidening`. The ordinary visibility route of a space refuses knowledge bases with `knowledgeBaseVisibility`.

## Content

A knowledge base contains only articles, areas and topics:

- **Articles** are pages. They always use publish mode: readers see the last published version while authors work on a draft. Live mode is not offered.
- **Areas and topics** are folders, nested to any depth, for example IT › Microsoft › Outlook › Web App. The top-level folders are **areas** and the folders below them **topics**, in the app and in the portal; it is one kind of folder in every other respect. The API calls them categories.
- Articles are placed in an area, in a topic or at the top level, never below another article. Articles and folders keep their kind; they cannot be converted.

Blog posts, meeting series, whiteboards and links are refused, through the interface, the API, moves, copies and every other path, with `knowledgeBaseContent`. A page in live mode or a page with subpages cannot be moved or copied into a knowledge base (`knowledgeBaseMode`, `knowledgeBasePlacement`); switch it to publish mode or move its subpages first.

## Articles

### Article type

An article has a type: **How-to**, **Troubleshooting** or none. A template sets it when the article is created; authors change it at the top of the article or with `PUT /api/v1/articles/{itemId}/type`. Readers filter by type in the portal. Templates of a knowledge base set the type in the template editor (**Space settings → Templates**) or with `articleType` in the template API.

The gallery of a knowledge base asks for the title of the new article. Left empty, the article gets the title of the template.

### Templates and sections

Two article templates ship with Lunedo, in English and German:

| Template | Sections |
|---|---|
| How-to (Anleitung) | What this is about, Before you start, Steps, Did it not work? |
| Troubleshooting (Störung) | What you see, Cause, Solution |

The sections are semantic: their key (`summary`, `prerequisites`, `steps`, `help`, `symptom`, `cause`, `resolution`) keeps its meaning in every language and is used by search, the API and later by the portal. A section of a template can carry an icon. In a knowledge base, the template gallery offers the article templates and the templates of the knowledge base itself; the general templates of the instance and organization are offered in standard spaces. Writing without a template is always possible.

Space admins can make sections required under **Space settings → Article templates**. Nothing is required by default. While a required section of an article is empty or missing, publishing is refused with `requiredSectionsEmpty`; the editor marks the section and puts the cursor into it. A section counts as filled when it has text, an image or another block; template hints do not count. Articles that are already published stay published.

### Screenshots

Images in the sections **Steps**, **What you see** and **Solution** are framed by default. Authors switch the frame off, or on for an image elsewhere, with the frame menu of the selected image. The setting is stored as the `frame` attribute of the image.

### Addresses

Every article gets a number when it is created or moved into the knowledge base. The number is unique within the knowledge base, never reused, and stays when the article moves within it. The address of an article is the number followed by a short form of its title, such as `123-vpn-verbindung-einrichten`. When the published title changes, the old short forms are kept so that old addresses can be redirected. Only titles that were published in this knowledge base count: working titles before the first publication never become addresses, and an article moved into another knowledge base starts there without the short forms of its old knowledge base. An article moved into another knowledge base gets a number there; its old number keeps pointing to it.

## Areas and topics

Every folder, at every depth, has an icon, an introduction and a contact address. The portal shows the folders in their order. Without an icon, it shows the name when it has at most three characters, otherwise its first letter.

The introduction is short formatted text of up to 1,000 characters, not a page: `**bold**`, `*italic*`, links as `[text](https://…)` or `[text](mailto:…)`, and one callout as lines starting with `>`. Links with other schemes stay plain text, and further quoted blocks are shown as normal paragraphs.

A folder's contact address is what readers use when an article did not help. A folder without its own address uses the address of the nearest folder above it that has one, and finally the address of the knowledge base. Space admins set the addresses. Lunedo sends nothing itself and creates no tickets.

API: `GET /api/v1/spaces/{spaceId}/categories` lists every folder the caller can read, with its depth (`level`), introduction (`description`), icon and the contact address that applies. `PUT /api/v1/categories/{itemId}` sets the icon, `PUT /api/v1/categories/{itemId}/contact` the contact address, both at any depth, and `PUT /api/v1/spaces/{spaceId}/knowledge-base/contact` the address of the knowledge base. Title, introduction and order change like for every folder. Articles carry the whole folder path above them as `categoryPath`.

## Languages

A knowledge base has a default language and can enable further languages under **Space settings → Languages**. While only one language is enabled, nothing about languages is visible to readers. The default language is chosen from the organization's language when the knowledge base is created.

- **Translations** are articles of their own, linked to their original. Open an article, choose its language next to the article type and **Translate into …** for an enabled language. The translation starts as a copy of the original, sits below it in the page tree, shares its number and category and gets its own address from its own title, for example `/help/help/en/12-change-the-password`. It has its own versions, owner and review. Moving the original moves its translations; a translation cannot be moved on its own.
- Articles in the default language always have the default language. The page language of the page menu is not offered in knowledge bases.
- A translation is **outdated** when its original was published after it. Outdated translations are marked at the article and in the article list, and the review list has the filter **Translations**. **Space settings → Languages** shows per language how many articles are translated, outdated or missing.
- Turning a language off keeps its translations but hides them from readers. A language that already has translations cannot become the default language.
- Changing the languages is recorded in the audit log as `knowledgeBase.languagesChanged`.

In the portal:

- The default language has the addresses without prefix; every other language is under `/<language>/`, for example `/help/help/en/`. From two enabled languages on, the top bar shows a language choice that leads to the same page in the other language and says how much is translated, such as "English · 14 of 46 translated", counted for the reader. Lists mark articles that are shown in the default language with "only German" (in the reader's language), and an article with a translation links to it with "Also in …".
- A reader who opens an article in a language without a published translation sees the article in the default language with a short note in the reader's language.
- The texts of the portal (buttons, headings, dates) always follow the chosen language, also on an article shown in the default language; the article itself is marked with its own language. Lunedo has portal texts in English and German; other languages use the English texts.
- The search looks in the reader's language first. When it finds nothing there, it shows the results in the default language with a note. Category pages and lists show the translation where one exists and the original otherwise.
- Public knowledge bases name the other languages of a page with `hreflang` links for search engines, plus `x-default` for the default language.

API: `GET` and `PUT /api/v1/spaces/{spaceId}/knowledge-base/languages`, `GET /api/v1/articles/{itemId}/translations` and `POST /api/v1/articles/{itemId}/translations` with `{ "language": "en" }`. Article lists and articles carry `language`, `translationOf` and the state of their translations.

## Articles through the API

Programs read and write articles with an API token of a service account that has a role in the knowledge base. The token's write level decides what it may do: read, write drafts that a person publishes in Lunedo, or write and publish. A token can be limited to selected knowledge bases. [api.md](api.md#knowledge-base-articles) describes the endpoints, the daily sync with `changedSince` and the numbers of removed articles, and writing reviewed articles back, with examples.

Scripts that migrate an existing FAQ create categories with `POST /api/v1/spaces/{spaceId}/items` and `"kind": "folder"`, then each article with `POST /api/v1/spaces/{spaceId}/articles` with its category, type and sections in Markdown, upload its images with `POST /api/v1/articles/{itemId}/images?name=…`, save the sections that reference them with `PUT /api/v1/articles/{itemId}/draft` and publish with `POST /api/v1/articles/{itemId}/publish`.

`GET /api/v1/spaces/{spaceId}/articles` lists the original articles a caller can read, newest change first, optionally of one category (`categoryId`), outside every category (`topLevel=true`) or of one type, with the state of their translations. `GET /api/v1/articles/{itemId}` returns the published version of an article with its number, short form, language, category path, lead, contact address, its sections with key, title, icon, plain text, HTML and ProseMirror content, its images, dates and portal address; editors and tokens that may write drafts get the draft with `draft=true`.

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

**Review** in the sidebar of the knowledge base lists the articles that are due or overdue, due within 30 days, whose source page changed, or that have no owner. Everyone with edit rights in the knowledge base sees it, each person only with the articles they may edit. The list shows title, area or topic, owner, interval, last review and the state, both as text and as a ring that fills up as the interval passes. Filters show due articles, articles due within 30 days or articles without an owner, and **Only my articles** shows the articles you own.

Articles without an owner show **Set owner** to space admins, who choose a person with edit rights by name. When an owner's account is deactivated, the space admins are notified, as for every space.

### Marking as reviewed

Anyone with edit rights marks an article as reviewed, in the review list, on **For you** or at the top of the article. The review is recorded in the article's history with who and when, without a new version, and the next due date starts from now. For a few seconds the review can be undone. Every review and every undo is recorded in the audit log as `article.reviewed` and `article.reviewUndone`.

When an author publishes a changed article and ticks **Content reviewed** in the publish dialog, the publication also counts as a review. The box is not ticked by default.

### For you

**For you** shows **Due for review** with the articles you own that are due within 30 days or whose source page changed, with **Mark as reviewed** for each. The section appears only when something is due.

## Source pages

An article can be based on internal pages, for example the operating documentation of a service. Editors link them at the top of the article under **Source pages** by searching for a page by title. A source page must be a page in a space of the same organization that is neither a knowledge base nor confidential, and the editor must be able to read it. An article has at most 20 source pages.

When a source page is published with changes, the article shows **Source page changed** in the review list until it is marked as reviewed, and its owner is notified once. Live pages count each saved version as a change. The notification and the review list name the article, never the source page.

In Lunedo, the link to a source page and its title are shown only to people who can read the source page; for everyone else the source does not exist. The portal for readers never shows source pages, and they are not part of the article's content or its machine-readable form. Editors of the article see only how many linked source pages they cannot read, and can remove those links, for example when the person who linked a restricted page has left; only people who can read such a page can link it again. Linking and removing a source page is audited as `article.sourceAdded` and `article.sourceRemoved`.

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
| `GET`, `DELETE /api/v1/articles/{itemId}/hidden-sources` | edit the article | number of linked source pages the caller cannot read; remove them |

`POST /api/v1/pages/{pageId}/publish` accepts `"reviewed": true` for articles. Reviews also appear in `GET /api/v1/items/{itemId}/activity` with the type `review`.

The portal shows "Last reviewed on" with the date of the last review while a review interval applies to the article and it was reviewed at least once; otherwise it shows "Updated on" with the date of the published version. `GET /api/v1/articles/{itemId}/review` returns the same values (`reviewedAt`, `effectiveIntervalMonths`).

## The portal

Readers open a knowledge base in its portal: a start page with the search and the areas, a page per folder, the articles, the search and a contact page. The portal has no navigation, page tree or editor, notifications or settings of the app. Which one people see depends only on the address they open; nobody is redirected between portal and app.

### Layout

- The top bar shows the logo and name, **Areas** with a menu of all top-level folders and their article counts, a search icon, the language and appearance choices and **Sign in** or the account menu. The search icon, `Ctrl`+`K` and `/` open a search window with matching topics and articles, each with its folder path; `↑`/`↓` choose, `Enter` opens, and **All results** leads to the search page. Without JavaScript the icon leads to the search page.
- The appearance follows the reader's system until the reader chooses light or dark in the top bar; the choice is kept in the browser. In dark mode the brand color uses its dark shade, so buttons stay readable.
- The start page shows the heading, the search with frequent searches, the areas as a compact grid, **Most read** and **Recently updated** with the folder path of each article (shortened in the middle when long) and **Didn't find an answer?**.
- Every folder page, at every depth, shows the tree of its area on the left (collapsible, with counts and a lock on folders with a view restriction), the breadcrumb, icon, title, introduction and contact line, its subfolders as tiles and its own articles with type filters and sorting. **Include subtopics** adds the articles of all folders below. A folder that only holds subfolders says so.
- Articles show the tree on the left and **On this page** on the right, **Was this helpful?**, **Write to us**, **Copy link** and related articles.
- At phone width the top bar becomes a menu, and the tree opens behind a **Topics** button.
- The footer is one line: name, **Contact** and, when switched on, "Made with Lunedo".

### Addresses

- Every knowledge base has a portal at `/help/<path>/` on the instance. The path is the space key in lowercase until a space admin changes it under **Space settings → Address**. A changed path keeps redirecting old links (301) to the new one. An old path stays reserved for the organization: only a knowledge base of the same organization can take it over. The paths of a knowledge base that is deleted for good stay reserved the same way.
- Articles have the address `<number>-<short form of the title>`, for example `/help/help/12-set-up-the-vpn-connection`. An old short form or the bare number redirects to the current address. A number of an article that moved to another knowledge base redirects there. Every folder, at any depth, is at `topics/<id>`, the search at `search?q=…`.
- An unknown address, a hidden article and an article that does not exist look exactly the same: "We can't find this page", status 404. A signed-in person who can read nothing in a knowledge base that is not public gets the same answer as for a portal that does not exist, without its name or welcome text.
- The change of a path or domain is recorded in the audit log as `knowledgeBase.portalAddressChanged`.

### Own domains

A knowledge base can have its own domain, for example the address of an older help center.

1. An instance administrator allows the domain for one organization under **Instance settings → Knowledge base portals** (`POST /api/v1/instance/portal-domains`). Allowing and removing are recorded in the audit log (`organization.portalDomainAllowed`, `organization.portalDomainRemoved`).
2. The DNS record of the domain points to the instance, and the reverse proxy sends the domain to Lunedo and holds its certificate. Lunedo does not request certificates itself. Portals on own domains need HTTPS.
3. A space admin chooses the domain under **Space settings → Address**, which lists only domains that are free or already used by this knowledge base. The page shows the DNS record to copy before saving.

On its own domain only the portal answers; the app and `/api/` are not reachable there. Health checks (`/health/…`), `/metrics` and the certificate check `/tls/ask` for reverse proxies ([reverse-proxy.md](reverse-proxy.md#own-domains-for-knowledge-base-portals)) answer on every host without a database lookup. Each API node keeps the list of allowed domains in memory and reloads it whenever a domain is allowed or removed on any node; while the database cannot be reached, requests to other hosts get status 503. The portal keeps working under `/help/<path>/` on the instance as well.

### Signing in

- Under `/help/<path>/` the portal uses the session of the app.
- Anonymous visitors of a knowledge base that is not public see the sign-in as a dialog over the portal on every address: the top bar stays, no content is shown behind it, and there is one button per identity provider of the instance and "Sign in with an e-mail address", which leads to the normal sign-in and back to the requested address.
- In a public knowledge base, an anonymous visitor who opens the address of a folder or article they cannot read gets a page that offers to sign in and continue there. Hidden and missing addresses get the same page, so it reveals nothing; after signing in, a page the reader still cannot read is "We can't find this page".
- On an own domain the portal has a session of its own. A visitor without one is sent to the instance; when they are already signed in there, they come back at once with a session for the domain, otherwise they sign in first. People who do not belong to the organization of the domain are asked once per account and domain ("Sign in to <domain> with your account?", **Continue**); the answer is remembered and recorded in the audit log as `portalHandoff.consented`. Members of the organization are not asked. The handoff uses a one-time code that is valid for 60 seconds, bound to the domain and to a random value in a cookie of the domain, and can be used once. The cookie of the domain (`__Host-lunedo-portal`) is host-only, `Secure`, `HttpOnly` and `SameSite=Lax`.
- The session of a domain belongs to the session of the instance. Signing out in the portal signs out everywhere; when the instance session ends (sign-out, expiry, deactivation, "sign out everywhere"), the session of the domain ends too.
- Requests that change something in the portal (rating, notes, sign-out) must come from the portal's own origin.

### Who sees what

- The portal shows only published versions. Drafts and articles that were never published are not shown, also not to editors.
- Folder lists and article counts are computed for each reader from the search index, for every folder at every depth. A folder the reader cannot read, and every article in it, is neither shown nor counted.
- People who may edit an article see **Edit**, which opens the article in the editor of the app. In the app, **View in portal** opens the knowledge base and, on a published article, the article in the portal.
- The account menu shows the name, the e-mail address, a link to the app and **Sign out**. The link to the app appears only for people who can see at least one space and never for portal accounts. Its name is set by instance administrators under **Instance settings → Knowledge base portals**; empty means "Go to the wiki".
- Frequent searches on the start page are the most searched terms of the last 90 days that had results, each searched at least three times. A reader sees only terms with which they find something themselves.

### Contact

- "Didn't help? Write to us" under an article opens the reader's mail program with the contact address of the article's folder (inherited from the folders above, then from the knowledge base), the article title as subject and the link to the article in the body. "Copy address" helps readers without a mail program.
- On a search without results, and on the contact page, the reader chooses the area: each top-level category with a contact address, and "Something else" for the address of the knowledge base.
- Lunedo sends nothing itself and creates no tickets.

### Appearance

Space admins set the appearance under **Space settings → Appearance and start page**. Changes apply at once.

- **Logo**: PNG, JPEG or WebP up to 256 KiB. Without one, the portal shows the organization's logo or the first letter of its name.
- **Brand color**: a color of the fixed palette, or an own color for light and dark mode. An own color must reach a contrast of 4.5:1 as text on the background and for text on it, in both modes. Otherwise Lunedo proposes the nearest shade that passes and saves it only after confirmation (`brandContrast` with `light` and `dark`, then `confirmProposal`).
- **Start page**: heading and a short text above the search.
- **"Made with Lunedo"** in the footer, on by default.
- **Notes of readers** are kept for 1 to 60 months (default 12). Shortening the period deletes older notes at once, after confirmation.

The help icon of the app can open a knowledge base of the organization instead of the Lunedo documentation: **Organization settings → General → Help**. Only knowledge bases that everyone signed in may read can be chosen.

API: `GET /api/v1/spaces/{spaceId}/knowledge-base/portal`, `PUT …/portal/address`, `PUT …/portal/appearance`, `PUT` and `DELETE …/portal/logo`, `GET …/portal/domains`; `GET` and `PUT /api/v1/organizations/{organizationId}/help`.

### Pre-rendered articles

The content of an article is rendered to HTML once per published version and stored; publishing queues the rendering, and a missing rendering is made on first read. Articles with included content, embeds, links to other articles or mentions are rendered on every request instead, for the person reading, so that a changed article, restriction, name or embed setting shows at once. Permissions are checked on every request before the HTML is served.

- **Includes and excerpts** from published articles of the same knowledge base are shown, because they have the same readers. An article that a view restriction hides from some readers of the including article, an article of another space and every other page stay hidden. Translations include the translation of the included article in their language where one is published.
- **Embeds** follow the embed services the organization allows (see [embeds-and-blocks.md](embeds-and-blocks.md)). The portal loads frames only from the addresses of these services; other embeds appear as a link.
- **Links to articles** of the same knowledge base show the current published title when the reader can read the target. Links to articles the reader cannot read (restricted, unpublished, in the trash or archived) and to pages outside the knowledge base show "No access" without their title or number.
- Child page lists, attachment lists and reports are left out of the page, images and files show only when they belong to the article or to an article with the same readers, and the HTML carries no internal IDs of people, pages, spaces or files. Mentions show the current name of members of the organization; anonymized people and people who left are not named.
- Search indexes, in the portal and in the static website, never contain the stored titles of linked pages.

## Static website

A public knowledge base can be downloaded as a static website: a ZIP file with plain HTML, CSS and JavaScript files that any web server can serve. The editing source stays the Lunedo instance; download a new ZIP after changes and upload it again, by hand or with your own script.

Space admins start the download on the export page of the knowledge base settings (`POST /api/v1/spaces/{spaceId}/exports` with `"format": "site"`). It is built in the background like other exports, with the same notification, download lifetime and audit entry. Knowledge bases whose audience is not "public" are refused with `staticSiteNotPublic`, because a static website has no sign-in; if the audience changes while the website waits to be built, it fails with the reason `notPublic`.

The ZIP contains:

- every published article that anonymous readers can read, in each enabled language (`<number>-<slug>.html`, translations in a folder per language such as `de/`), rendered like in the portal, with includes from the same knowledge base and allowed embeds;
- the start page (`index.html`), a page per category (`topics/<id>.html`), the contact page and a search page per language;
- a search index per language (`search-index.json`), built with [MiniSearch](https://github.com/lucaong/minisearch); the search page loads it in the browser, searches the reader's language first and falls back to the default language with a note;
- images in their display versions (`files/`), fonts, styles and scripts (`_assets/`);
- redirects from earlier addresses of an article: a small HTML page per old address and a `_redirects` file that Cloudflare Pages and Netlify understand;
- `404.html`, and with an address of the website (`siteUrl`, for example `https://help.example.org/`) also `sitemap.xml`, `robots.txt` and language links for search engines.

All links are relative, so the website works under any domain and in a subfolder. Things that need Lunedo are left out: the "Was this helpful?" question, reader statistics, the most-read list, sign-in and the account menu. The contact links stay, because they open the reader's e-mail program. The search needs JavaScript and a web server; opened from a local folder, browsers do not let the page read the index, and the search page says so.

### Publishing on Cloudflare Pages

In the dashboard: **Workers & Pages → Create → Pages → Upload assets**, name the project, drag the unpacked folder (not the ZIP file) into the upload area and deploy. Each new upload replaces the website.

With Wrangler:

```sh
unzip "Help 2026-10-20.zip" -d site
npx wrangler pages deploy site --project-name=help
```

Cloudflare Pages reads `_redirects` and `404.html` by itself and serves `/12-vpn` for `12-vpn.html`.

### Any web server

Copy the unpacked folder to the web server's document root (or a subfolder). Without further settings, the website works with its `.html` addresses and the HTML redirect pages. To serve addresses without `.html` and the `404.html` page with nginx:

```nginx
location /help/ {
    try_files $uri $uri.html $uri/index.html =404;
    error_page 404 /help/404.html;
}
```

GitHub Pages serves the files as they are; old addresses work through the HTML redirect pages.

## Moving a knowledge base to another instance

The Markdown and HTML archives of the export keep what a knowledge base needs:

- Every Markdown file starts with front matter: `title`, `created`, `updated`, `labels` and a `lunedo` block with the kind, version, author, `articleType`, `language` and `translation: true` for translations.
- Sections are marked with comments around their heading and content, such as `<!-- lunedo:section key="steps" icon="list-ordered" -->` … `<!-- /lunedo:section -->`. Markdown viewers do not show them.
- Each article sits in its own folder with its images; translations sit in folders below their article, and categories are folders.
- HTML files carry `<html lang>` and a `lunedo:article-type` meta element; sections keep their `data-section` and `data-icon` attributes.

To move a knowledge base, export it as Markdown, start a Markdown import on the other instance and turn on **Import as a knowledge base**. Folders become categories, files become articles with their type, sections and images, and translations are linked to their article again. Numbers are assigned anew in the order of the import. The new knowledge base opens only for the people and groups given a role when the import is accepted; choose its audience in the visibility settings afterwards.

## Reader statistics

The portal records what readers do, without any account, session or address. No table below has a column for one, and nothing is derived from the reader. The search statistics below are built on this data.

| Table | One row per | Columns |
|---|---|---|
| `portal_searches` | search | `space_id`, `term` (trimmed, lowercase, at most 200 characters), `results`, `zero_results` (generated: `results = 0`), `category_id` of a category filter or null, `searched_at` (to the hour) |
| `portal_article_views` | article and day | `item_id`, `space_id`, `day`, `views` |
| `portal_ratings` | article and day | `item_id`, `space_id`, `day`, `helpful`, `unhelpful` |
| `portal_feedback` | note after "No" | `id`, `item_id`, `space_id`, `day`, `text` (at most 2,000 characters) |
| `portal_search_months` | term and month | `space_id`, `term`, `month` (first day), `searches`, `zero_results` |

- Searches are recorded on the first page of results; each device counts at most 60 searches in ten minutes. Article views are counted when an article page is served.
- "Was this helpful?" records yes or no; a note after "No" is stored separately. Double votes are prevented only in the browser.
- A note is deleted when the retention of its knowledge base ends for it: each note gets a job that runs on its day of deletion and checks the current retention, so a longer retention moves the job and a shorter one deletes older notes at once. A daily sweep deletes notes whose job was lost.
- Searches older than 12 months are kept only as counts per term and month in `portal_search_months`, and only for terms searched at least 3 times in that month; rarer searches are deleted. The first search of a day schedules a job for the day the searches turn 12 months old, which moves them into the monthly counts; a daily sweep catches searches whose job was lost.
- Rows of an article or knowledge base go when it is deleted permanently.

The read interface is `PortalStatistics` in `@lunedo/server` (`services.portalStatistics`). Periods are `{ from, to }` with ISO dates, both included. It does not check permissions; the routes that use it decide who may read the statistics.

| Method | Returns |
|---|---|
| `views(spaceId, period)` | article views per day |
| `articleViews(spaceId, period, limit?)` | most viewed articles with their counts |
| `searches(spaceId, period)` | number of searches and of searches without results |
| `topTerms(spaceId, period, { limit, minimum })` | most frequent terms with searches, searches without results and the last search; only terms searched at least `minimum` times (default 3) |
| `zeroResultTerms(spaceId, period, { limit, minimum })` | the same for searches without results |
| `ratings(spaceId, period, itemId?)` | helpful and not helpful per article |
| `feedback(spaceId, { itemId, period, limit, before })` | notes, newest first, without any personal reference |
| `feedbackCounts(spaceId, period)` | notes per article |
| `frequentSearches(spaceId, limit?)` | terms for the start page |

## Search statistics

"Search statistics" in the knowledge base shows editors and space admins what readers do in the portal, for the last 7, 30 or 90 days or 12 months:

- searches, the share without results, article views and the share of answers "Yes" to "Was this helpful?";
- searches without results, with "Create article", which opens a new article with the term as its title;
- the most frequent search terms;
- articles rated as not helpful, with their notes;
- the most read articles.

A term appears only once it was searched at least 3 times in the period, so that a single search for a name stays hidden. Nothing names a person. Articles the person cannot read are left out with their ratings, views and notes.

Space admins can delete a note for good, for example when it contains personal data. The deletion is audited as `article.feedbackDeleted`, without the text.

API: `GET /api/v1/spaces/{spaceId}/statistics?period=30d`, `GET /api/v1/spaces/{spaceId}/statistics/articles/{itemId}/feedback` and `DELETE /api/v1/spaces/{spaceId}/statistics/feedback/{feedbackId}`.
