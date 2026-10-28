# Web client

`apps/web` is a single-page application built with React, Vite and TanStack Router and Query, and served by the API process. It uses only the HTTP API and the collaboration WebSocket; every decision about permissions is made by the server. Rules for new screens are in [interface-patterns.md](interface-patterns.md).

## Structure

The build has four entry pages: `index.html` (the application), `print.html` (the print viewer that the render container loads), `preview.html` (the isolated frame that previews attached files) and `diagram.html` (the isolated frame that renders Mermaid and PlantUML).

| Folder in `src` | Content |
|---|---|
| `router.tsx`, `root-layout.tsx`, `route-data.ts` | Route tree. Most screens are part of the main bundle; large ones, such as the setup assistant, the import screens and `/dev/components`, load with their route. |
| `shell` | Top bar, sidebar, spaces panel, command palette, keyboard shortcuts, banners and the registries |
| `api` | API client, `request()`, queries, the error type and the maintenance status |
| `app-update` | Detection of a new build, reload after updates |
| `session` | Sign-in with providers and passkeys, reauthentication, sign-out |
| `screens` | Screens by area: `auth`, `setup`, `account`, `organization`, `instance`, `identity`, `settings` |
| `settings` | Setting fields, saving, and the index behind the settings search |
| `spaces` | Spaces, the page tree, the page screen, versions, trash, archive, owners, labels and space settings |
| `editor` | The page editor, the read view, toolbars, slash menu and block views |
| `collaboration` | Home screen, comments, reactions, stars, tasks and the blog |
| `whiteboards`, `diagrams`, `diagram-frame` | Whiteboards and drawings (Excalidraw), draw.io, Mermaid and PlantUML |
| `files`, `preview` | Attachments, uploads and file previews |
| `sharing` | Shares, share links and access requests |
| `knowledge-bases` | Knowledge base settings, categories, translations, reviews and statistics |
| `meetings` | Meeting series and agendas |
| `search` | Quick search, search screen, saved searches |
| `imports`, `exports`, `print` | Import wizard and re-imports; PDF, Word, Markdown and static website exports; the print viewer |
| `notifications`, `chat` | Notification panel, watching, browser push, the event stream and the notification type registry; chat channels |
| `embeds` | The allowlist of external embeds |
| `components` | Building blocks shared by screens, such as the settings list, the audit log, pickers and table state |
| `errors`, `forms` | Error presentation; forms with the shared Zod schemas |
| `preferences`, `format`, `i18n` | Preferences and appearance; date, time and number formatting; i18next setup and the English and German messages |
| `docs` | Links into the documentation |
| `dev` | `/dev/components` and build helpers; the route exists only in development and end-to-end builds |

## Registration points

Features add entries to registries instead of changing the shell (`src/shell/extensions.ts`); the built-in entries are registered in `src/shell/builtin.tsx`:

| Registry | Use |
|---|---|
| `topBarItems` | Entries in the top bar |
| `navigationItems` | Settings navigation by section (account, organization, instance) and group, also listed in the command palette |
| `spaceSettingsItems` | Pages of the space settings, with the reason when a page does not apply to a space |
| `commands` | Actions in the command palette |
| `shortcuts` | Keyboard shortcuts, listed in the overview under `?` |

`notificationTypes` in `src/notifications/notification-types.ts` registers the icon and link of each notification type. A registry rejects an ID that is registered twice and keeps entries in their `order`.

Navigation entries name the permission they need. The shell asks `GET /api/v1/account/permissions` which actions the user may perform and hides the rest; the server still checks every request.

## API types

`pnpm --filter @lunedo/web api:types` generates `src/api/generated/schema.d.ts` from `apps/api/openapi.json` with openapi-typescript. `build`, `dev`, `typecheck` and `test` run it first, so a client that no longer matches the API fails the typecheck. Requests go through openapi-fetch; there are no hand-written request or response types. How `openapi.json` is generated is in [api.md](api.md).

## Requests

Every changing request carries the header `X-Lunedo-Request: 1`. `request()` in `src/api/request.ts`:

- turns Problem Details into an `ApiError`,
- asks for reauthentication when the server answers `reauthenticationRequired` and repeats the request once,
- sends the browser to the sign-in page with the current address when the session ended,
- replaces the screen with a link to the new address when the server answers `instanceMoved`,
- reloads the maintenance status when the server answers `maintenanceMode` or `signInPaused`,
- marks the client as outdated on `clientOutdated`.

## Updates

A production build writes an identity of its chunks into `build.json` and into the `lunedo-build` meta tag of its pages. The API reads `build.json` from `LUNEDO_WEB_ROOT` and names it in the header `X-Lunedo-Build` of every response. When a response names a different build than the one running in the tab, the client loads the target of the next route change in full instead of rendering it, and a hidden tab reloads at once. Neither happens while the editor or a form has unsaved changes; the client waits until the person leaves them. There is no polling: only responses the client asks for anyway carry the header.

Every API request carries `X-Lunedo-Client-Api` with the API level of the client. When the server answers `409` with the code `clientOutdated`, the client shows a notice with **Reload**, or **Save and reload** while the editor has unsaved changes. When to raise the level is in [api.md](api.md#client-api-level).

When a lazily loaded part of the client is gone after an update, the client reloads once instead of showing an error. A second failure within a minute shows the error, so a broken build cannot reload in a loop.

## Editor

The editor is Tiptap 3. Its nodes and marks are derived from the module definitions of `@lunedo/editor-schema` (`src/editor/schema`), so the editor accepts exactly the documents the server accepts; a unit test compares both schemas and round-trips every stored fixture through the editor. Blocks with their own interface, such as images, diagrams, drawings, embeds, task reports and meeting blocks, have node views in `src/editor/nodes`. The read view renders the stored document with `renderHtml` from the same package and fills the placeholders of reports and listings from the API. See [editor-schema.md](editor-schema.md).

## Collaboration client

`src/editor/collaboration.ts` connects the editor and whiteboards to the collaboration server with the Hocuspocus provider (see [collaboration.md](collaboration.md)):

- One connection per document is shared by every editor of the same page in the tab. When the last editor closes, the connection stays until its changes are saved.
- `SaveTracker` (`src/editor/save-state.ts`) derives the save state that the editor shows: connecting, editing, saving, saved, offline or not saved. It shows "Saved" only when the `saved` message of the server covers the tab's own changes.
- A refused connection or a close with a known reason becomes a problem with a title, an explanation and an action in the editor (`editor.problems.*` in the messages).
- A close with `unavailable` is temporary: the client reattaches after 1, 2, 5, 10 and then every 30 seconds.
- Closing the tab while changes are not saved asks for confirmation, and signing out drops every connection.

## Offline

When the browser reports that it is offline, the editor disconnects at once, shows "Offline, changes are kept in this tab" and keeps editing in the local Yjs document. When the browser is online again, the provider reconnects and Yjs merges the changes with what others wrote meanwhile. Nothing is stored in the browser beyond the open tab.

## Maintenance

While maintenance mode is on, `MaintenanceBanner` (`src/shell/maintenance-banner.tsx`) shows that Lunedo is read-only, whether signing in is paused, and the administrators' message. The client reads the status from `GET /api/v1/maintenance` and reloads it when the event stream sends a `maintenance` event or a request fails with `maintenanceMode` or `signInPaused`. Open editors switch to read-only through the collaboration server and continue without a reload when the maintenance ends. See [maintenance-mode.md](../admin/maintenance-mode.md).

## Live updates

The event stream (`/api/v1/notifications/stream`) carries the events `notifications`, `announcements`, `maintenance`, `imports`, `spaces`, `changes`, `settings` and `syncRuns`. The client invalidates the affected queries. A `settings` event names the changed key, its level and the organization; the client then reloads the preferences and the affected settings, so changes made in another tab, by an administrator or at a higher level apply without a reload. The user's own changes apply at once.

## Appearance and language

Preferences are user-level settings (`GET /api/v1/account/preferences`, `PUT /api/v1/account/preferences/{key}`) and inherit from the organization and the instance. Date format, time format, number format and first day of the week always hold a concrete value; one setting never changes another, so changing the language changes only texts. Color mode, high contrast, text size, density and the reading-friendly font are applied as attributes on the root element; all sizes are in `rem`, so the text size scales spacing and icons. The accent color comes from the current organization. Before sign-in, the last appearance and the language chosen on the sign-in page are kept in local storage.

Messages use the ICU message format. Keys are English identifiers grouped by area. `pnpm i18n:check` checks the messages and the components (see [ci.md](ci.md#translations)), and a unit test checks that every key the code uses exists.

Dates, times and numbers are formatted in the user's time zone with the chosen formats (`src/format`).

## Unit tests

Unit tests run with Vitest and happy-dom: `pnpm --filter @lunedo/web test`.

## End-to-end tests

End-to-end tests run with Playwright against the built API, collaboration server, worker and web client on a fresh database:

```sh
pnpm build
pnpm --filter @lunedo/web build:e2e
pnpm --filter @lunedo/web test:e2e
```

They need PostgreSQL and Mailpit from the development environment. `LUNEDO_E2E_DATABASE_URL` and `LUNEDO_E2E_MAILPIT_URL` override the defaults, `LUNEDO_E2E_PORT` the port of the test instance (default 4310). The global setup (`e2e/global-setup.ts`) starts the processes, reads the setup code from the log and drops the database afterwards. It leaves Mailpit as it is, so that several runs and the development instance can share it; every test waits for mail to an address of its own.

The tests run on 3 Playwright workers; `LUNEDO_E2E_WORKERS` overrides it. The projects in `playwright.config.ts`:

| Project | Folder | Runs |
|---|---|---|
| `setup` | `e2e/setup` | Sets up the instance once. |
| `flows` | `e2e/flows` | Feature tests. Every test gets its own organization with its own administrator from the `organization` fixture in `e2e/support/fixtures.ts`, created for each attempt, and its own client address, so that tests share no data and no rate limit; the instance trusts the forwarded address only because the test server lists the loopback address in `LUNEDO_TRUSTED_PROXIES`. |
| `components` | `e2e/components` | Checks of single components on `/dev/components`, such as hit areas and the position of toasts. |
| `sweeps` | `e2e/sweeps` | Every check that repeats across themes, languages, widths or text sizes (axe and screenshots). Runs after `flows` and `components`; `LUNEDO_E2E_SWEEPS=false` leaves it out. |
| `instance` | `e2e/instance` | Tests that change what every organization sees, such as instance settings, sign-in providers, backups and maintenance mode. Runs alone on one worker, after all other projects. |
| `idp` | `e2e/idp` | Sign-in through Keycloak, Authentik and OpenLDAP. Exists only with `LUNEDO_E2E_IDP=1`, see [test-identity-providers.md](test-identity-providers.md). |

A flow test checks the accessibility of its screens once, at the default appearance. The sweeps run axe on the main screens and on `/dev/components` in light, dark and high-contrast mode, at the smallest and largest text size and in German; any violation fails. German runs also check that labels, which are often about 30 % longer, do not overflow on a phone or at desktop width. In CI the sweeps run only when the web client, `packages/ui`, `packages/tokens` or the end-to-end tests changed, and always on `main` (see [ci.md](ci.md#scope)).

Time limits fail fast: 15 seconds per action, 45 seconds per navigation, 60 seconds per test. Tests wait for a visible state that means the screen is ready, never for `networkidle`. More rules are in [stable-tests.md](stable-tests.md).

### Screenshots

Screenshots of `/dev/components` (`e2e/sweeps/components.spec.ts`) are compared on Linux only, in English and German (`?lang=de`). Record them in the same image CI uses, with the Playwright version of the lockfile:

```sh
docker run --rm --network host -v "$PWD:/work" -w /work mcr.microsoft.com/playwright:v1.64.1-noble \
  sh -c "corepack enable && pnpm --filter @lunedo/web exec playwright test e2e/sweeps/components.spec.ts --project sweeps --no-deps --update-snapshots"
```

`pnpm playwright-image:check` fails when the image in the workflows and the Playwright version in the lockfile differ.

## Screens

`pnpm screens:capture <directory>` builds the project, starts a fresh end-to-end instance, fills it with synthetic content and captures every main screen into the directory: desktop (1440×900) and, for the reading screens, phone (390×844), each in light and dark mode, in German and for some screens also in English. `index.md` in the directory lists every file with its route, role and state, and the screens that could not be captured. Choose a directory outside the repository, for example one per date, to compare the interface before and after a change. `--skip-build` reuses the last build.

The same run also takes the start-page picture of the documentation website: `website/hero-light.png` and `website/hero-dark.png`, 2880×1800 pixels (1440×900 at device scale factor 2), English interface, the page "On-call runbook" in the editor with three other people editing it. The clock in the browser is fixed, so two runs give the same picture. `--only website` takes only these two pictures, `--only screens` only the screens of the interface. The pictures are not part of the repository.

The run needs the development database and Mailpit (`pnpm dev`) and uses port 4410 (`LUNEDO_E2E_PORT`); the scenario lives in `apps/web/e2e/screens` and `apps/web/playwright.screens.config.ts`.
