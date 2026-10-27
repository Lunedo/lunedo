# Interface patterns

Screens are built from the components in `packages/ui`; `/dev/components` shows each of them in every state, in development and end-to-end builds. New screens follow these rules, so that the interface behaves the same everywhere. Visual values come only from the design tokens (see [architecture.md](architecture.md#design-tokens)); texts come from the messages (see [web-client.md](web-client.md#appearance-and-language)).

## Choosing from many options

| Options | Component |
|---|---|
| Up to 4 fixed options | `SegmentedControl` |
| 5 to 10 fixed options | `Select` |
| More than 10 options, or options that come from data (people, groups, organizations, roles, time zones, languages) | `Combobox`, which searches as you type, is operated with the arrow keys, Home, End, Enter and Escape, and says when nothing matches |
| Several values | `Combobox` with `multiple`, which shows the chosen values as removable chips |

- Data that can be large, such as accounts or groups, is searched on the server: pass `load(query, cursor)` instead of `items`. The combobox debounces the input, shows the newest answer only and offers "Load more" while a next cursor exists. `apps/web/src/components/pickers.ts` has loaders for accounts, members and groups, which search on the server with `q` and a cursor.
- Time zones use `TimeZoneCombobox`. It matches city, region and offset, shows the current offset and local time of each zone, and lists the inherited and the browser's time zone first.
- The list of every select and combobox is at least as wide as its trigger.
- People never type internal IDs. Wherever something from another system or from the data is chosen, the interface searches by name and stores the ID.

## Settings

- Every setting is one `SettingRow` with three columns: label, description and source line on the left; exactly one control in a fixed-width column; the "…" menu (`menu`) in a fixed column on the right, also when a row has no menu. `SettingControl` in `apps/web/src/components/setting-control.tsx` picks the control for a setting's type.
- The "…" menu holds **Where does this value come from?**, **Reset to default**, and locking for lower levels and **Unlock**, as far as they apply.
- Choices use `SettingSelect`. Options list the concrete values once, with an example where it helps, such as "24-hour (14:30)". The option equal to the inherited value carries a "Default" marker. While the setting is inherited, that option is selected and the control is muted; choosing it later follows the default again, choosing another option overrides it.
- Durations use `DurationSelect`: the common values of the setting, plus "Custom…", which opens a small popover with a number and a unit. Values are always shown as readable durations, such as "30 days".
- Format options show an example of the result.
- One setting never changes the value of another. Each setting holds its own value, inherited or set.

### Saving settings

All settings pages save the same way:

- Switches, selects and segmented controls save as soon as they change.
- Text, number and duration fields save when they lose focus or on Enter.
- After saving, "Saved" appears next to the field for a moment. A failed save shows the error at the field with a retry button.
- Fields that are only valid together, such as an SMTP server, save with one button. Identity and security values, such as the own e-mail address, the instance address or credentials, use explicit Save and Cancel.
- Only changes that affect other people ask first: locking a setting for lower levels, and changes of access. The dialog says who is affected.

Every change applies without a reload, also in other tabs and for other people, through the event stream (see [web-client.md](web-client.md#live-updates)).

## Page layout

- Settings and table screens use `SettingsPage` (`apps/web/src/screens/settings/settings-page.tsx`). Pages that are mainly a form or settings use its narrow width and get an "On this page" list of their sections on wide screens. Pages that are mainly a table or list set `wide` and fill the content area.
- A table page has one `TableToolbar` above the table: search, filters and "Reset filters" on the left, actions such as export on the right. Server-side tables use `useServerTable` from `apps/web/src/components/table-state.ts`, which debounces the search and pages with the server's cursor.
- Clicking a table row, or pressing Enter on it, opens the object (`onRowClick` with `rowLabel`). Clicks on buttons, links and menus inside a row do not open it; the "…" menu holds secondary actions only.
- Access levels per area use `ChoiceTable`: the area and its explanation on the left, a `SegmentedControl` in one aligned column on the right. Options a person may not choose stay visible, disabled, with the reason in a tooltip (`disabledReason`).
- Destructive actions sit in a danger zone at the end of the page (`DangerZone`, `DangerAction`), and their buttons name the action.

## Forms and errors

Forms use React Hook Form with the Zod schemas from `@lunedo/shared`, which the server uses for the same fields (`useSchemaForm` in `apps/web/src/forms/use-schema-form.ts`). Validation messages come from the issue codes, not from the schema's English text, so they appear in the user's language; fields with special formats name their own message. Field errors reported by the server mark the matching fields.

Every other error answers three questions: what failed, the likely cause, and what to do. The title names the failed action (`failures.*`), the text comes from the problem `code` (`problems.*`) and says what to do next. `FailureNotice`, `LoadError` and `useFailureToast` in `apps/web/src/errors/failure.tsx` show them, with a retry button unless retrying cannot help, for example for invalid input or missing permissions. A screen whose data cannot load shows the error in the content area, next to the navigation. Failed setup checks show the cause from the structured check result, a fix command to copy and a link to the documentation.

## Texts

- Layouts handle texts about 30 % longer than English; the end-to-end tests check German labels on a phone and at desktop width. Truncated text has a tooltip with the full text.
- Labels use the terms of the product consistently; every text comes from the messages in `apps/web/src/i18n/locales`.
