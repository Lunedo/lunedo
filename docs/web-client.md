# Web client

`apps/web` is a single-page application built with React and Vite and served by the API process. It uses only the HTTP API; every decision about permissions is made by the server.

## Structure

| Folder | Content |
|---|---|
| `src/api` | API client, queries, error type |
| `src/router.tsx` | Route tree; every screen is loaded with its route |
| `src/shell` | Icon rail, command palette, keyboard shortcuts, organization context and the registries |
| `src/screens` | Screens by area: `auth`, `setup`, `account`, `organization`, `instance`, `settings` |
| `src/components` | Building blocks shared by screens, such as the settings list, the audit log and the access preview |
| `src/notifications` | Notification panel, live updates and the notification type registry |
| `src/preferences`, `src/format` | Preferences, appearance, and date and number formatting |
| `src/i18n` | i18next setup and the English and German messages |
| `src/dev` | `/dev/components`, only in development and end-to-end builds |

## API types

`pnpm --filter @pagehall/web api:types` generates `src/api/generated/schema.d.ts` from `apps/api/openapi.json` with openapi-typescript. `build`, `dev`, `typecheck` and `test` run it first, so a client that no longer matches the API fails the typecheck. Requests go through openapi-fetch; there are no hand-written request or response types.

Every changing request carries the header `X-Pagehall-Request: 1`. `request()` turns Problem Details into an `ApiError`, asks for reauthentication when the server answers `reauthenticationRequired` and repeats the request once, and sends the browser to the sign-in page with the current address when the session ended.

## Forms and errors

Forms use React Hook Form with the Zod schemas from `@pagehall/shared`, which the server uses for the same fields. Validation messages come from the issue codes, not from the schema's English text, so they appear in the user's language; fields with special formats name their own message. Field errors reported by the server mark the matching fields.

Every other error answers three questions: what failed, the likely cause, and what to do. The title names the failed action (`failures.*`), the text comes from the problem `code` (`problems.*`) and says what to do next. `FailureNotice`, `LoadError` and `useFailureToast` in `src/errors/failure.tsx` show them, with a retry button unless retrying cannot help, for example for invalid input or missing permissions. A screen whose data cannot load shows the error in the content area, next to the navigation. Failed setup checks show the cause from the structured check result, a fix command to copy and a link to the documentation.

## Saving settings

All settings pages save the same way:

- Switches, selects and segmented controls save as soon as they change.
- Text, number and duration fields save when they lose focus or on Enter.
- After saving, "Saved" appears next to the field for a moment. A failed save shows the error at the field with a retry button.
- Only changes that affect other people ask first: locking a setting for lower levels, and changes of access. The dialog says who is affected.

Every settings row has the same three columns: label, description and source on the left, exactly one control of fixed width in the middle, and the "…" menu with "Reset to default" and locking on the right (`SettingControl` in `src/components/setting-control.tsx`). While a value is inherited, the control shows it muted, and the option equal to it carries a "Default" marker; choosing that option follows the default again.

Durations use a select with the common values of the setting plus "Custom…", which opens a number and a unit, and are always shown in words, such as "30 days". Format options show an example of the result.

## Choosing and tables

Choices follow the rule in [development.md](development.md): segmented controls for up to four fixed options, selects for five to ten, and searchable comboboxes for more or for data. People, groups and organizations are searched on the server with `q` and a cursor (`src/components/pickers.ts`). Table pages use the full width with one toolbar row; clicking a row opens the object, and the "…" menu holds only secondary actions. Server-side tables use `useServerTable` from `src/components/table-state.ts`.

## Live updates

The notification event stream (`/api/v1/notifications/stream`) also carries a `settings` event with the changed key, its level and the organization. The client then reloads the preferences and the affected settings, so changes made in another tab, by an administrator or at a higher level apply without a reload. The user's own changes apply at once.

## Registration points

Later features add entries without changing the shell:

| Registry | Module | Use |
|---|---|---|
| `railItems` | `shell/extensions.ts` | Entries in the icon rail |
| `navigationItems` | `shell/extensions.ts` | Settings navigation, also listed in the command palette |
| `commands` | `shell/extensions.ts` | Actions in the command palette |
| `shortcuts` | `shell/extensions.ts` | Keyboard shortcuts, listed in the overview under `?` |
| `notificationTypes` | `notifications/notification-types.ts` | Icon and link of a notification type |

Navigation entries name the permission they need. The shell asks `GET /api/v1/account/permissions` which actions the user may perform and hides the rest; the server still checks every request.

## Appearance and language

Preferences are user-level settings (`GET` and `PUT /api/v1/account/preferences`) and inherit from the organization and the instance. Date format, time format, number format and first day of the week always hold a concrete value; one setting never changes another, so changing the language changes only texts. Color mode, high contrast, text size, density and the reading-friendly font are applied as attributes on the root element; all sizes are in `rem`, so the text size scales spacing and icons. The accent color comes from the current organization. Before sign-in, the last appearance and the language chosen on the sign-in page are kept in local storage.

Messages use the ICU message format. Keys are English identifiers grouped by area. `pnpm i18n:check` fails when a key exists in one language only, when a message is empty, or when a component in `apps/web` or `packages/ui` contains text that does not come from the messages. A unit test checks that every key the code uses exists.

Dates, times and numbers are formatted in the user's time zone with the chosen formats (`src/format`).

## Tests

- Unit tests run with Vitest and happy-dom: `pnpm --filter @pagehall/web test`.
- End-to-end tests run with Playwright against the built API, worker and web client on a fresh database: `pnpm build`, `pnpm --filter @pagehall/web build:e2e`, then `pnpm --filter @pagehall/web test:e2e`. They need PostgreSQL and Mailpit from the development environment; `PAGEHALL_E2E_DATABASE_URL` and `PAGEHALL_E2E_MAILPIT_URL` override the defaults. The global setup starts the processes, reads the setup link from the log and drops the database afterwards.
- End-to-end tests run on 3 Playwright workers locally (`PAGEHALL_E2E_WORKERS` overrides it) and on `CI_PARALLELISM` workers in CI. The project `setup` sets up the instance once. Every test in `flows` gets its own organization with its own administrator from the `organization` fixture in `e2e/support/fixtures.ts`, created for each attempt, and its own client address, so that tests share no data and no rate limit; the instance trusts the forwarded address only because the test server lists the loopback address in `PAGEHALL_TRUSTED_PROXIES`. Tests that change what every organization sees, such as instance settings or sign-in providers, belong in `e2e/instance`; that project runs alone and serially after all other projects.
- Every check that repeats across themes, languages, widths or text sizes (axe and screenshots) lives in `e2e/sweeps`. The project `sweeps` runs after `flows` and `components`; a flow test checks the accessibility of its screens once, at the default appearance. In CI the sweeps run only when the web client, `packages/ui`, `packages/tokens` or the end-to-end tests changed, and always on `main`; `PAGEHALL_E2E_SWEEPS=false` leaves them out.
- Time limits fail fast: 15 s per action, 45 s per navigation, 60 s per test. Sweeps that cover many screens call `test.slow()`. Tests wait for a visible state that means the screen is ready, never for `networkidle`; Biome rejects it.
- The end-to-end tests run axe on the main screens and on `/dev/components` in light, dark and high-contrast mode, at the smallest and largest text size and in German; any violation fails. German runs also check that labels, which are often about 30 % longer, do not overflow on a phone or at desktop width.
- Screenshots of `/dev/components` (`e2e/sweeps/components.spec.ts`) are compared on Linux only, in English and German (`?lang=de`). Record them in the same image CI uses:

```sh
docker run --rm --network host -v "$PWD:/work" -w /work mcr.microsoft.com/playwright:v1.63.0-noble \
  sh -c "corepack enable && pnpm --filter @pagehall/web exec playwright test e2e/sweeps/components.spec.ts --project sweeps --no-deps --update-snapshots"
```
