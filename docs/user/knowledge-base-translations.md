# Knowledge base translations

A knowledge base has a default language and can enable further languages. Articles are written in the default language and translated into the others. While only one language is enabled, readers see nothing about languages.

## Enabling languages

1. Open **Space settings › Publishing › Languages**. Only space admins change the languages.
2. Choose the **Default language**: the language of new articles and the fallback for readers whose language has no translation. When the knowledge base is created, it is the language of the organization if articles can be written in it, otherwise English.
3. Under **Enabled languages**, use **Add a language**. A knowledge base can have up to 30 languages. The default language always stays enabled.

From two enabled languages on, the portal shows a language choice. **State of the translations** shows per language how many articles are translated, outdated or missing.

- Turning a language off keeps its translations but hides them from readers.
- A language that already has translations cannot become the default language. Delete those translations first.
- Changing the default language updates the search of all articles in the background; the progress shows on the page.
- Changing the languages is recorded in the [audit log](../admin/audit-log.md) as `knowledgeBase.languagesChanged`.

## Translating an article

1. Open the original article.
2. Click **Languages** at the top of the article. The list shows each enabled language with its state: **Original**, **Up to date**, **Outdated**, **Not published** or **Missing**.
3. Choose **Translate into …** for a language.
4. Translate the text and publish the translation.

A translation is an article of its own, linked to its original:

- It starts as a copy of the original, with its title, type and template, and sits below the original in the page tree.
- It has its own title, versions, owner and review.
- It shares the area or topic of its original. Moving the original moves its translations; a translation cannot be moved on its own.
- Only originals can be translated, and each original has at most one translation per language.

Articles in the default language always have the default language. The page language of the page menu is not offered in knowledge bases.

## Outdated translations

A translation is **outdated** when its original was published after the translation was last published or marked as reviewed. Outdated translations are marked at the article and in the article list. In the review list, the filter **Translations** shows them (see [Knowledge base reviews](knowledge-base-reviews.md#review-list)).

Compare an outdated translation with the original, then publish it again, or, if it still matches, **Mark as reviewed**.

## Addresses

In the app, a translation is a page with a number of its own. In the portal, it uses the number of its original, its own short form and the language as prefix. For the German translation of article 1040 in IT Help (English default language):

| Where | Original | German translation |
|---|---|---|
| App | `/spaces/ITHELP/pages/1040/set-up-the-vpn-connection` | `/spaces/ITHELP/pages/1057/vpn-verbindung-einrichten` |
| Portal | `/help/ithelp/1040-set-up-the-vpn-connection` | `/help/ithelp/de/1040-vpn-verbindung-einrichten` |
| Static website | `1040-set-up-the-vpn-connection.html` | `de/1040-vpn-verbindung-einrichten.html` |

**Edit** on the translation in the portal opens the translation in the app with its own number.

## Languages in the portal

- The default language has the addresses without prefix; every other language is under `/<language>/`, such as `/help/ithelp/de/`. An address with the prefix of the default language redirects to the address without it.
- The top bar shows a language choice that leads to the same page in the other language and says how much is translated, such as "14 of 46 translated", counted for the reader.
- Lists mark articles that are shown in the default language with "only …", and an article with a translation links to it with "Also in …".
- A reader who opens an article in a language without a published translation sees the article in the default language with a short note in the reader's language.
- The texts of the portal (buttons, headings, dates) follow the chosen language, also on an article shown in the default language; the article itself is marked with its own language. Lunedo has portal texts in English and German; other languages use the English texts.
- The search looks in the reader's language first. When it finds nothing there, it shows the results in the default language with a note. Area and topic pages and lists show the translation where one exists and the original otherwise.
- Public knowledge bases name the other languages of a page with `hreflang` links for search engines, plus `x-default` for the default language.
