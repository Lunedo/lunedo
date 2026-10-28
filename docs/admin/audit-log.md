# Audit log

The audit log records every action that affects security, access or configuration: sign-ins, changes of accounts, roles, groups and settings, identity providers, API tokens, backups, maintenance mode and more. It is separate from the application log in the container output. Scripts read it through the API, described in [api/audit-log.md](../api/audit-log.md). [Audit events](audit-events.md) lists every event it records.

## What an entry holds

Each entry records who acted (an account, a service account or token, anonymous or the system), the action, its target, the time, the request ID, the client address and the browser. Setting changes record the setting, its level, the previous and the new value and the lock state. Updates of organizations, groups, roles, service accounts and API tokens record the previous values.

Each entry also keeps the names at the time of the event: of the acting account, of the target, of the organization and of every account, group or role it refers to. Renaming them later does not change the entry.

Entries never contain passwords, tokens, codes or other secrets. Personal preferences such as the color mode or the language are not recorded; security-relevant personal actions such as sign-ins, password and second-factor changes, sessions and tokens are.

Events about a confidential space keep no titles or names of its content. People who cannot see that space see such an event without the people involved, with the note that it concerns a confidential space. The **By** filter and the **Activity** tabs leave such events out for them.

## Who reads it

| Where | Who | What |
|---|---|---|
| **Settings › Instance › Log › Audit log** | Instance owner and administrators, the security auditor and custom instance roles with the audit log area | Events of the instance and of every organization |
| **Settings › Organization › Integrations and security › Audit log** | Organization owners and administrators and roles with the audit log area | Events of this organization |
| Tab **Activity** of an account under **Settings › Instance › People and sign-in › Accounts** | Everyone who reads the instance audit log | Sign-ins, security and account changes of that person from the instance audit log, and events about the account in its organizations, such as ended sessions |
| Tab **Activity** of a member under **Settings › Organization › People and access › Members** | Everyone who reads the organization audit log | Events of that person in this organization |

## Finding events

The list shows the newest events first, with **Time**, **By**, **Action**, **Target** and **Address**. Select an event to see its details: who acted, the target, **Where** it happened, **Changes** with the values before and after, the **Client IP address**, the **Browser**, the **Request ID** and the **Raw event**. **Previous** and **Next** step through the list.

Filter the list with:

- **Period**: **Any time**, **Last 24 hours**, **Last 7 days**, **Last 30 days** or **Custom period …** with **From** and **To**.
- **Action**: one kind of event, searchable by name, for example **Maintenance mode switched on**. **All events** shows every kind.
- **By**: one person. **Everyone** shows all.

**Reset filters** clears all filters.

## Exporting

**Export CSV** downloads every event that matches the current filters, not only the page on screen, as `lunedo-audit-<date>.csv`. The first columns are readable, with names in place of IDs: time, actor, action (the name of the event, for example `maintenance.started`), target, scope and changes. The raw fields follow. Cells that start with `=`, `+`, `-`, `@`, a tab or a carriage return get a leading apostrophe, so spreadsheets do not run them as formulas.

Every export is itself recorded as **Audit log exported**, with its filters. An exported file is outside Lunedo: it keeps every name and address, also after an account is anonymized. Store it accordingly.

## Retention

Lunedo removes events older than **Audit log retention** under **Settings › Instance › People and sign-in › Policies**, section **Retention**. The default is 365 days; the range is 1 to 36,500 days. The removal runs once a day at 03:41 UTC. The setting exists only for the instance; organizations cannot change it.

Removing old events does not break the integrity check: Lunedo keeps the hash of the last removed entry as the start of the remaining chain.

## Personal data and anonymization

The name, e-mail address, IP address and browser of an account are stored encrypted in its events, with a key of that account. Anonymizing an account destroys this key. Its events remain and show **Former user** with the account ID; the integrity check still passes. See [encryption.md](encryption.md) for the keys in general.

## Checking integrity

Each scope, the instance and every organization, forms a hash chain: every entry contains the hash of the previous one, and the database refuses to change or delete entries. To check every chain:

```sh
docker compose exec lunedo lunedo audit verify
```

The command prints one line per scope, for example `Audit log of the instance is intact: 1042 entries.` When an entry was changed, removed or inserted, it names the scope and the first broken entry and exits with status 1. With every chain intact, it exits with 0.

The chain detects changes made directly in the database. Someone who can write to the database can also rewrite a whole chain consistently, so protect database access and keep backups.
