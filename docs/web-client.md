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

Forms use React Hook Form with the Zod schemas from `@pagehall/shared`, which the server uses for the same fields. Validation messages come from the issue codes, not from the schema's English text, so they appear in the user's language; fields with special formats name their own message. Field errors reported by the server mark the matching fields. Other errors are shown through `problemMessage`, which translates the problem `code`.

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

Preferences are user-level settings (`GET` and `PUT /api/v1/account/preferences`) and inherit from the organization and the instance. Color mode, high contrast, text size, density and the reading-friendly font are applied as attributes on the root element; all sizes are in `rem`, so the text size scales spacing and icons. The accent color comes from the current organization. Before sign-in, the last appearance and the language chosen on the sign-in page are kept in local storage.

Messages use the ICU message format. Keys are English identifiers grouped by area. `pnpm i18n:check` fails when a key exists in one language only, when a message is empty, or when a component in `apps/web` or `packages/ui` contains text that does not come from the messages. A unit test checks that every key the code uses exists.

Dates, times and numbers are formatted in the user's time zone with the chosen formats (`src/format`).

## Tests

- Unit tests run with Vitest and happy-dom: `pnpm --filter @pagehall/web test`.
- End-to-end tests run with Playwright against the built API, worker and web client on a fresh database: `pnpm build`, `pnpm --filter @pagehall/web build:e2e`, then `pnpm --filter @pagehall/web test:e2e`. They need PostgreSQL and Mailpit from the development environment; `PAGEHALL_E2E_DATABASE_URL` and `PAGEHALL_E2E_MAILPIT_URL` override the defaults. The global setup starts the processes, reads the setup code from the log and drops the database afterwards.
- The end-to-end tests run axe on the main screens and on `/dev/components` in light, dark and high-contrast mode and at the smallest and largest text size; any violation fails.
- Screenshots of `/dev/components` are compared on Linux only. Record them in the same image CI uses:

```sh
docker run --rm --network host -v "$PWD:/work" -w /work mcr.microsoft.com/playwright:v1.63.0-noble \
  sh -c "corepack enable && pnpm --filter @pagehall/web exec playwright test --project components --update-snapshots"
```
