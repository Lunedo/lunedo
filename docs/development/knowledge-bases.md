# Knowledge bases

How the knowledge base portal, its pre-rendered articles, the sign-in on own domains, the background jobs and the reader statistics work inside. The behaviour that people see is described in [Knowledge bases](../user/knowledge-bases.md) and the pages linked from there.

The portal lives in `packages/server/src/portal/` (reader, renderer, sessions, statistics, static website under `site/`) and `apps/api/src/portal/routes.ts` (the HTTP entry). Knowledge base rules, reviews, translations, category access and portal accounts live in `packages/server/src/knowledge-bases/`.

## Request routing

The portal is not a NestJS controller. `registerPortal` adds a Fastify `onRequest` hook that runs before the API routes:

1. Paths under `/health`, `/metrics` and `/tls` pass through on every host without a database lookup, so health checks and the certificate check for reverse proxies keep working on portal domains.
2. When the host is not the host of the instance URL, the hook asks whether it is an allowed portal domain. If so, the portal answers every path on that host; the app and `/api/` are not reachable there. If the domain list cannot be read, the request gets `503` with `Retry-After: 30`.
3. On the instance host, paths under `/help/` go to the portal. The first segment is the portal path. A retired path of the same knowledge base answers `301` to the current path.
4. A two-letter prefix that is an enabled language of the knowledge base selects that language; the prefix of the default language answers `301` to the address without it.

Portal paths below the base (`/help/<path>` or the root of an own domain):

| Path | Method | Purpose |
|---|---|---|
| `/` | GET | start page |
| `/<number>[-<slug>]` | GET | article; wrong or missing slug: `301` to the current address |
| `/topics/<number>[-<slug>]` | GET | area or topic; wrong or missing slug: `301` |
| `/search?q=…` | GET | search page, with `category`, `type` and the cursor `after` |
| `/search/quick?q=…` | GET | JSON for the quick search window |
| `/search/quick/count` | POST | counts a quick search for the statistics |
| `/contact` | GET | contact page |
| `/feedback` | POST | rating or note for an article |
| `/files/<attachmentId>` | GET | image or file of a readable published article, `?size=display` for the display version |
| `/logo` | GET | logo of the knowledge base or the organization |
| `/_assets/…` | GET | styles, scripts, fonts and brand icons (`/help/_assets/…` on the instance) |
| `/sign-in`, `/sign-in/provider/<id>` | GET | sign-in screen and provider start on the instance; handoff start on an own domain |
| `/authorize` | GET, POST | instance side of the domain handoff, with the consent form |
| `/_portal/callback` | GET | domain side of the handoff |
| `/sign-out`, `/signed-out` | POST, GET | sign-out |

`POST` requests must come from the portal's own origin (`Origin` header, and not `Sec-Fetch-Site: cross-site`); otherwise they get `403`. Feedback is limited to 30 requests and searches are counted at most 60 times per client address in ten minutes, through the rate limiter. During maintenance `/feedback` answers `503`.

Every page is sent with a content security policy that allows scripts, styles, fonts and images only from the portal itself, frames only from the allowed embed services, and no framing of the portal (`frame-ancestors 'none'`).

### Article lookup

`PortalReader.article` looks the number up among originals (`translation_of is null`) and joins their translations. The portal number of a translation is the number of its original; the translation keeps its own `tree_items.number`, which the **Edit** link uses. When the original belongs to another knowledge base, the lookup returns a redirect and the route answers `301` to that knowledge base's portal, on its domain or its path. A missing translation in the requested language falls back to the original with `fallback: true`; such an article keeps any slug of its language versions and otherwise redirects to the bare number.

Unknown, hidden and unpublished articles all return `null` and the same 404 page. `admits` returns false for a signed-in person who can read nothing in a non-public knowledge base, and the route then answers with the same bare 404 as for a portal that does not exist.

## Domain list

`PortalService.isPortalDomain` keeps the set of allowed domains in memory on each API node. `enableDomainCache` listens on the PostgreSQL channel `lunedo_portal_domains` and drops the set whenever a domain is allowed or removed on any node, and again after the listener reconnects. The next request loads it again. A failed load is not cached, so the next request tries again.

## Sign-in on own domains

A portal on an own domain has its own session, bound to a session of the instance:

1. `/sign-in` on the domain sets the cookie `__Host-lunedo-portal-flow` with a random state (10 minutes) and redirects to `<instance>/help/<path>/authorize?domain=…&state=…&return=…`.
2. The instance requires a full session there. People who are not a member of the organization that owns the domain, and have not agreed before, see the consent page. Agreeing stores a row in `portal_handoff_consents` and records `portalHandoff.consented` in the audit log.
3. `issueHandoff` stores a one-time code in `portal_handoffs`, hashed, together with the hashed state, the domain and the instance session. It is valid for 60 seconds.
4. The browser is sent to `https://<domain>/_portal/callback?code=…&state=…&return=…`. The callback compares the state with the flow cookie, clears the cookie and redeems the code once, for this domain only.
5. Redeeming creates a row in `portal_sessions` that references the instance session, and sets the cookie `__Host-lunedo-portal` for the domain, with the session lifetime of the instance as `Max-Age`.

All portal cookies are `Path=/`, `HttpOnly`, `Secure` and `SameSite=Lax`, without a `Domain` attribute. Because `portal_sessions` and `portal_handoffs` reference `sessions` with `on delete cascade`, ending the instance session (sign-out, expiry, deactivation, sign out everywhere) ends every domain session. Signing out in the portal ends the instance session. Removing a domain deletes its sessions and handoffs.

Return addresses are accepted only as local paths.

## Pre-rendered articles

`ArticleRenderer` renders the published version of an article to HTML with `renderHtml` from `@lunedo/editor-schema` and stores the result in `article_renders` (one row per version and interface language, with the renderer version `ARTICLE_RENDERER`). Publishing in the app or through the article API queues the job `portal.render-article` with the version ID as idempotency key; a missing rendering is made on first read.

Documents with live parts are rendered on every request for the person reading and never stored: includes and excerpts, embeds, links to pages and mentions (`hasLiveParts`). That way a changed article, restriction, name or embed setting shows at once. Permissions are checked on every request before the HTML is served.

- Includes and excerpts resolve only published articles of the same knowledge base that the reader can read. Other spaces and pages stay hidden. A translation includes the published translation of the included article in its language where one exists. Includes are limited in depth and to 50 per article.
- Embeds follow the embed services the organization allows; other embeds appear as a link.
- Links to readable articles of the same knowledge base show the current published title. Links to articles the reader cannot read (restricted, unpublished, in the trash or archived) and to pages outside the knowledge base show "No access" without title or number.
- Child page lists, attachment lists, reports and label lists are removed before rendering. Images and files appear only when they belong to an article with the same readers. `data-*` attributes that carry IDs of people, pages, spaces or files are stripped from the HTML. Mentions show the current name of members of the organization; anonymized people and people who left are not named.
- Links to articles and files are stored with the placeholder `/__portal__` (`PORTAL_BASE_PLACEHOLDER`) and replaced by the portal base when the page is built (`site/views.ts`).
- Search indexes in the portal and in the static website never contain the stored titles of linked pages.

### Image frames

Images inside the sections `steps`, `symptom` and `resolution` (`FRAMED_SECTIONS` in `packages/editor-schema/src/modules/structure.ts`) are framed by default. The image attribute `frame` overrides this: `true` frames an image anywhere, `false` removes the frame, `null` follows the section. The HTML carries `data-framed` on the section and `data-frame="on"` or `"off"` on the image; the portal styles in `site/styles.ts` draw the frame.

## Static website

`StaticSiteBuilder` in `site/static-site.ts` builds the ZIP for the export format `site`. It reads every published original and translation of an enabled language, keeps only those that `PortalReader.article` returns for an anonymous reader without fallback, and renders them with the same renderer. File names are `<number>-<slug>.html` with the portal number, translations in `<language>/`. Earlier slugs come from `article_titles`; each one and the bare number get an HTML redirect page and a line in `_redirects`. The search index is a serialized MiniSearch index per language. The build fails with the reason `notPublic` when the audience is no longer public.

## Background jobs

| Job | Trigger | Work |
|---|---|---|
| `portal.render-article` | publishing an article | stores the rendering of the published version |
| `knowledge-bases.queue-reviews` | `NOTIFY` on `lunedo_review_changes`, start of a node, reconnect of the listener | schedules a reminder job for each pending lead and due reminder |
| `knowledge-bases.remind-review` | scheduled for the moment the reminder is due | sends one reminder; idempotency key from article, kind, due date and lead days |
| `knowledge-bases.check-reviews` | hourly at minute 17 | safety net: queues pending reminders again and sends overdue reminders whose job was lost |
| `knowledge-bases.prune-removed-articles` | daily at 03:43 | deletes the records of removed articles (`article_sync`) after 90 days; the article sync of the API reports removed articles from them |
| `portal.delete-feedback` | scheduled per note for its day of deletion | checks the current retention and deletes the note or moves the job |
| `portal.feedback-retention` | daily at 03:41 | safety net: deletes notes past the retention whose job was lost |
| `portal.aggregate-searches` | the first search of a day per knowledge base schedules it for the day the searches turn 12 months old; daily at 03:47 as safety net | moves searches older than 12 months into monthly counts |

The schedules are cron expressions in `knowledge-bases/jobs.ts` and `portal/statistics.ts`. When a space admin changes the retention of notes, `retentionChanged` deletes older notes at once and schedules the deletion job of every remaining note again.

## Reader statistics

The portal records what readers do without any account, session or address. No table has a column for one, and nothing is derived from the reader.

| Table | One row per | Columns |
|---|---|---|
| `portal_searches` | search | `id`, `space_id`, `term` (trimmed, lowercase, 1 to 200 characters), `results`, `zero_results` (generated: `results = 0`), `category_id` of a category filter or null, `searched_at` (to the hour) |
| `portal_article_views` | article and day | `item_id`, `space_id`, `day`, `views` |
| `portal_ratings` | article and day | `item_id`, `space_id`, `day`, `helpful`, `unhelpful` |
| `portal_feedback` | note after "No" | `id`, `item_id`, `space_id`, `day`, `text` (1 to 2,000 characters) |
| `portal_search_months` | term and month | `space_id`, `term`, `month` (first day), `searches`, `zero_results` |

- Searches are recorded on the first page of results and for the quick search, at most 60 per client address in ten minutes. Article views are counted when an article page is served.
- "Was this helpful?" records yes or no; a note after "No" is stored separately. Double votes are prevented only in the browser (`localStorage`).
- Searches older than 12 months are kept only as counts per term and month, and only for terms searched at least 3 times in that month; rarer searches are deleted.
- Rows of an article or knowledge base go when it is deleted permanently (foreign keys with `on delete cascade`).

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
| `frequentSearches(spaceId, limit?)` | candidate terms for the start page: searched at least 3 times in the last 90 days with results |

The start page checks each candidate with the reader's own search and shows at most four terms that find something for that reader.
