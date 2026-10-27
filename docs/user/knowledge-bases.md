# Knowledge bases

A knowledge base is a space of the type **Knowledge base**. It holds articles, such as how-tos and troubleshooting articles, sorted into areas and topics. Authors write in the normal Lunedo interface, with the same editor, versions, comments, permissions and search as in every other space. Readers use the **portal**, a lean site of its own without the navigation, page tree or editor of the app (see [Knowledge base portal](knowledge-base-portal.md)).

The examples on the knowledge base pages use one knowledge base: **IT Help** with the space key `ITHELP` on the instance `https://wiki.nordwind.test`. It has the area **Network** with the topic **VPN** (number 1012), the how-to article **Set up the VPN connection** (1040), the troubleshooting article **VPN connection drops** (1041), and a German translation of article 1040.

## Creating a knowledge base

1. Create a space as described in [Spaces and pages](spaces-and-pages.md).
2. Under **Type of space**, choose **Knowledge base**. The type cannot be changed after the space is created.
3. Under **Who may read it**, choose the audience (default: **All signed-in people**). With **Specific groups**, give at least one group a role below, for example Reader. See [Knowledge base access](knowledge-base-access.md).
4. Create the space. You become its space admin. Add editors in the dialog or later under **Space settings › Access › Permissions**. Who may edit is set with roles; who may read is set with the audience.

A knowledge base has no overview page. Its start page lists the articles by area. A knowledge base cannot be confidential, and personal spaces are never knowledge bases.

The sidebar of a knowledge base shows **Articles**, and for people who may edit also **Review** (see [Knowledge base reviews](knowledge-base-reviews.md)) and **Search statistics** (see [Knowledge base portal](knowledge-base-portal.md#search-statistics)). **View in portal** opens the knowledge base in its portal and, on a published article, that article.

## Content

A knowledge base contains only articles, areas and topics:

- **Articles** are pages. They always use publish mode: readers see the last published version while authors work on a draft. Live mode is not offered. See [Publishing and page status](publishing-and-page-status.md).
- **Areas and topics** are folders, nested to any depth, for example Network › VPN › Windows. The folders at the top level are **areas**, the folders inside them **topics**, in the app and in the portal. In every other respect they are one kind of folder.
- Articles are placed in an area, in a topic or at the top level, never below another article. Articles and folders keep their kind; they cannot be converted.

Blog posts, meeting series, whiteboards and links cannot be created in a knowledge base or moved or copied into it. A page in live mode or a page with subpages cannot be moved or copied into a knowledge base; switch it to publish mode or move its subpages first.

## Articles

### Writing an article

**New article** opens the template gallery of the knowledge base. It offers the article templates that ship with Lunedo, the own templates of the knowledge base and **Blank article**. The general templates of the instance and the organization are offered only in standard spaces.

- **Title of the article**: left empty, the article gets the title of the template; rename it later.
- **Area or topic**: where the article appears in the portal. Choose **No area (top level)** to keep it outside every area. You can move it later.

### Article type

An article has a type: **How-to**, **Troubleshooting** or **No type**. A template sets it when the article is created. Authors change it at the top of the article. Readers filter by type in the portal, and a how-to shows related troubleshooting articles of its topic.

### Templates and sections

Two article templates ship with Lunedo, in English and German:

| Template | Sections |
|---|---|
| How-to (Anleitung) | What this is about, Before you start, Steps, Did it not work? |
| Troubleshooting (Störung) | What you see, Cause, Solution |

Each section has an icon and a key (`summary`, `prerequisites`, `steps`, `help`, `symptom`, `cause`, `resolution`) that keeps its meaning in every language. Search, the article API and the export use the keys.

Space admins manage templates under **Space settings › Content › Templates**:

- **Article templates** lists the templates that ship with Lunedo and the own templates with their sections. Switch on **Steps is required** (named after each section) to make a section required in articles created from that template. Nothing is required by default.
- **Own templates** holds the templates of this knowledge base. The template editor sets their article type. See [Templates](templates.md).

While a required section of an article is empty or missing, publishing is refused: the editor names the sections, marks them and puts the cursor into the first one. A section counts as filled when it has text, an image or another block; template hints do not count. Articles that are already published stay published.

### Screenshots

Images in the sections **Steps**, **What you see** and **Solution** are framed by default. To switch the frame off, or on for an image elsewhere, select the image and use **Frame** in its toolbar.

### Article numbers and addresses

Every article has a number from the one sequence of the instance, like every page (see [Content addresses](content-addresses.md#content-numbers-and-addresses)). Pages of other spaces use the same sequence, so the numbers in a knowledge base are large and have gaps. The number never changes and is not reused, also when the article is moved or renamed.

| Where | Address of article 1040 |
|---|---|
| App | `/spaces/ITHELP/pages/1040/set-up-the-vpn-connection` |
| Portal | `/help/ithelp/1040-set-up-the-vpn-connection` |

The short form after the number follows the same rule in the app and in the portal. Letters of non-Latin scripts stay and are percent-encoded in addresses. A translation has a number of its own in the app and uses the number of its original in the portal; see [Knowledge base translations](knowledge-base-translations.md#addresses). The portal addresses are described in [Knowledge base portal](knowledge-base-portal.md#addresses).

To open an article by its number, type the number, such as `1040` or `#1040`, into the search. When you can read the item, the search opens it; the quick search shows it first under **Open by number**.

## Areas and topics

Editors and space admins set up the folders under **Space settings › Content › Areas and topics**: create areas with **New area** and topics with **New topic inside**, drag a folder to reorder it or to move it into the folder above, and use the **…** menu to move one level up or into the folder above. The portal shows the areas and topics in this order.

Every folder, at every depth, has:

- **Icon**: chosen from a fixed list. Without an icon, the portal shows the name when it has at most three characters, otherwise its first letter.
- **Introduction**: short formatted text of up to 1,000 characters, not a page: `**bold**`, `*italic*`, links as `[text](https://…)` or `[text](mailto:…)`, and one note as lines starting with `>`. Links with other schemes stay plain text, and further quoted blocks are shown as normal paragraphs.
- **Contact address**: where readers write when an article did not help. A folder without its own address uses the address of the nearest folder above it that has one, and finally the **Contact address of the knowledge base**. The field shows where an inherited address comes from and offers to return to it. Only space admins change contact addresses. Lunedo sends nothing itself and creates no tickets.

Each folder also has two access settings, **Responsible** and **Visible to**; see [Knowledge base access](knowledge-base-access.md#access-per-area-and-topic).

## Help icon

The help icon in the top bar of the app opens the Lunedo documentation. An organization can make it open one of its knowledge bases instead: in **Settings › Organization › General**, section **Help**, choose the knowledge base under **Help icon opens**. Only knowledge bases that everyone signed in may read can be chosen, that is with the audience **Public** or **All signed-in people**, and not archived or deleted.

When no knowledge base is chosen, or the chosen one no longer qualifies (its audience was narrowed, or it was archived or deleted), the help icon opens the Lunedo documentation.

## Export, API and moving

- Articles and the whole knowledge base can be exported like other content (see [Export](export.md)). A public knowledge base can also be downloaded as a [static website](knowledge-base-static-website.md).
- Programs read and write articles with an API token of a service account; see [Knowledge base articles](../api/knowledge-base-articles.md).
- To move a knowledge base to another Lunedo instance, see [Moving knowledge bases](../admin/moving-knowledge-bases.md).

## For you

**For you** shows the section **Due for review** with the articles you own that are due within 30 days or whose source page changed, at most 20, with **Mark as reviewed** for each. When there are more, a line names how many more are in the review lists of the knowledge bases. The section appears only when something is due. See [Knowledge base reviews](knowledge-base-reviews.md).
