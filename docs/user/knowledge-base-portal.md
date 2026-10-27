# Knowledge base portal

Readers open a knowledge base in its portal: a start page with the search and the areas, a page per area and topic, the articles, the search and a contact page. The portal has no navigation, page tree, editor, notifications or settings of the app. Which one people see depends only on the address they open; nobody is redirected between portal and app.

## Addresses

Every knowledge base has a portal at `/help/<path>/` on the instance, for example `https://wiki.nordwind.test/help/ithelp/`. The path is the space key in lowercase; when that path is taken, a number is added, such as `ithelp-2`.

| Page | Address in the portal of IT Help |
|---|---|
| Start page | `/help/ithelp/` |
| Article 1040 | `/help/ithelp/1040-set-up-the-vpn-connection` |
| Topic 1012 | `/help/ithelp/topics/1012-vpn` |
| Search | `/help/ithelp/search?q=vpn` |
| Contact page | `/help/ithelp/contact` |
| German translation of article 1040 | `/help/ithelp/de/1040-vpn-verbindung-einrichten` |

- An article and a category use the number they have in the app, from the one number sequence of the instance, followed by a short form of the title. The short form follows the same rule as in the app (see [Content addresses](content-addresses.md#content-numbers-and-addresses)).
- A translation uses the number of its original in the portal, its own short form, and the language prefix. In the app it has a number of its own. See [Knowledge base translations](knowledge-base-translations.md#addresses).
- An article address with an outdated short form, for example after a rename, or with the bare number (`/help/ithelp/1040`) redirects permanently (301) to the current address. The same holds for categories.
- When an article is moved to another knowledge base, its old address redirects permanently (301) to the article in the portal of the other knowledge base, on its path or its own domain.
- An unknown address, a hidden article and an article that does not exist look exactly the same: "We can't find this page", status 404. A signed-in person who can read nothing in a knowledge base that is not public gets the same answer as for a portal that does not exist, without its name or welcome text.

### Changing the address

1. Open **Space settings › Publishing › Address**. Only space admins change it.
2. Click **Change**, enter the new **Path** (lowercase letters, digits and single hyphens, at most 60 characters) and save.

Links to the old path keep redirecting (301) to the new one. An old path stays reserved for the organization: only a knowledge base of the same organization can take it over. The paths of a knowledge base that is deleted for good stay reserved the same way. A change of the address is recorded in the [audit log](../admin/audit-log.md) as `knowledgeBase.portalAddressChanged`.

On the same page, a space admin can choose an **Own domain**, for example the address of an older help center, once an instance administrator has allowed it for the organization. The page shows the DNS record to copy before saving. The setup is described in [Knowledge base portals](../admin/knowledge-base-portals.md#own-domains).

## Appearance

Space admins set the appearance under **Space settings › Publishing › Appearance and start page**. **Open the portal** shows the result. Changes apply at once.

| Setting | Values |
|---|---|
| **Logo** | PNG, JPEG or WebP, square, up to 256 KiB. Without a logo, the portal shows the organization's logo or the first letter of its name. |
| **Brand color** | A color of the fixed palette, or **Own color** with a value for light and for dark mode. Used for links, the main actions and highlights. |
| **Heading** | Shown above the search, up to 120 characters. Empty: "How can we help?" in the language of the portal. |
| **Short text** | One or two sentences below the heading, up to 400 characters. Optional. |
| **Show "Made with Lunedo"** | A small note in the footer. On by default. |
| **Retention of notes** | 1 to 60 months, default 12. Notes that readers leave after "No" are deleted after this period. |

Palette colors reach the required contrast in both modes. An own color is saved with **Check contrast and save**. It must reach a contrast of 4.5:1 as text on the background and for text on it, in light and dark mode. Otherwise Lunedo proposes the nearest shade that passes; choose **Use the proposed shades** or **Choose another color**.

Shortening the retention of notes asks first and then deletes older notes at once; they cannot be restored.

The areas appear in the order set under **Space settings › Content › Areas and topics** (see [Knowledge bases](knowledge-bases.md#areas-and-topics)).

## What readers see

### Layout

- The top bar shows the logo and name, **Areas** with a menu of the areas and their article counts, a search icon, the language and appearance choices and **Sign in** or the account menu.
- The search icon, `Ctrl`+`K` and `/` open a quick search with matching topics and articles, each with its folder path. `↑` and `↓` choose, `Enter` opens, and the last entry (for example "All 12 results") leads to the search page. Without JavaScript the icon leads to the search page.
- The appearance follows the reader's system until the reader chooses light or dark; the choice is kept in the browser.
- The start page shows the heading, the search with frequent searches, the areas, **Most read** and **Recently updated** and **Didn't find an answer?**.
- Every area and topic page shows the tree of its area, the breadcrumb, icon, title, introduction and contact line, its topics and its own articles with type filters and sorting. **Include subtopics** adds the articles of all folders below. A folder that only holds topics says so.
- An article shows the tree, **On this page**, **Was this helpful?**, **Didn't help? Write to us**, **Copy link**, related troubleshooting articles for a how-to and similar articles of the same topic. For a reviewed article with a review interval it shows "Last reviewed on" with that date, otherwise "Updated on" with the date of the published version.
- At phone width the top bar becomes a menu, and the tree opens behind a **Topics** button.
- The footer shows the name, **Contact** and, when switched on, "Made with Lunedo".

### Who sees what

- The portal shows only published versions. Drafts and articles that were never published are not shown, also not to editors.
- Area lists and article counts are computed for each reader. A folder the reader cannot read, and every article in it, is neither shown nor counted.
- People who may edit an article see **Edit**, which opens the article in the editor of the app.
- The account menu shows the name, the e-mail address, a link to the app and **Sign out**. The link to the app appears only for people who can see at least one space, never for portal accounts. Portal accounts see **Account settings** instead. Its name is set for the instance (see [Knowledge base portals](../admin/knowledge-base-portals.md)); empty means "Go to the wiki".
- Frequent searches on the start page are the most searched terms of the last 90 days that had results, each searched at least three times. A reader sees only terms with which they find something themselves.
- Child page lists, attachment lists and reports are left out of articles. Links to articles the reader cannot read and to pages outside the knowledge base show "No access" without their title.

### Signing in

- Under `/help/<path>/` the portal uses the session of the app.
- Anonymous visitors of a knowledge base that is not public see a sign-in page on every address, with one button per identity provider of the instance except LDAP, and **Sign in with an e-mail address**, which leads to the normal sign-in page. Afterwards they come back to the requested address.
- In a public knowledge base, an anonymous visitor who opens an address they cannot read gets a page that offers to sign in and continue there. Hidden and missing addresses get the same page, so it reveals nothing.
- On an own domain the portal sends visitors to the instance to sign in and back. People who do not belong to the organization of the domain are asked once per account and domain ("Sign in to … with your account?").
- **Sign out** in the portal signs you out of the portal and of the app in that browser.

### Contact

- **Didn't help? Write to us** under an article opens the reader's mail program with the contact address of the article's folder (inherited from the folders above, then from the knowledge base), the article title as subject and the link to the article in the body. **Copy address** helps readers without a mail program.
- On a search without results and on the contact page, the reader chooses the area: each area with a contact address, and **Something else** for the address of the knowledge base.
- Lunedo sends nothing itself and creates no tickets.

## Search statistics

**Search statistics** in the sidebar of the knowledge base shows editors and space admins what readers do in the portal, for the last 7, 30 or 90 days or 12 months:

- searches, the share without results, article views and the share of answers "Yes" to "Was this helpful?";
- searches without results, with **Create article**, which opens a new article with the term as its title;
- the most frequent search terms;
- articles rated as not helpful, with the notes readers left;
- the most read articles.

The portal counts without names, accounts, sessions or IP addresses. A term appears only once it was searched at least 3 times in the period, so that a single search for a name stays hidden. Articles you cannot read are left out with their ratings, views and notes. Searches older than 12 months are kept only as counts per term and month, for terms searched at least 3 times that month.

Space admins can **Delete note** for good, for example when it contains personal data. The deletion is recorded in the [audit log](../admin/audit-log.md) without the text.
