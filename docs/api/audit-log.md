# Audit log

Read and export the audit log of the instance or of an organization. [Audit log](../admin/audit-log.md) explains what the log records, how long it is kept and how its integrity is checked. The full reference is at `/api/docs` on your instance.

## Routes

| Route | What it does | Permission |
|---|---|---|
| `GET /api/v1/organizations/{organizationId}/audit-events` | Events of one organization, newest first | `organization.audit.view` |
| `GET /api/v1/organizations/{organizationId}/audit-events/export` | The same events as CSV | `organization.audit.view` |
| `GET /api/v1/instance/audit-events` | Events of the instance and of all organizations, newest first | `instance.audit.view` |
| `GET /api/v1/instance/audit-events/export` | The same events as CSV | `instance.audit.view` |

Organization administrators and holders of the organization area audit log read the events of their organization. Instance administrators and security auditors read all events. A token needs the area `auditLog` with `view` in its scopes.

## Filters

All four routes take the same filters:

| Parameter | Only events |
|---|---|
| `from` | at or after this time (ISO 8601) |
| `to` | before this time |
| `actorId` | done by this account |
| `personId` | about this person: done by them, or naming them as the target or as the account or holder concerned |
| `targetType` | about this kind of object, for example `group` |
| `targetId` | about this object; combine it with `targetType` |
| `name` | of this event type, for example `role.assigned` |

The instance routes also take:

| Parameter | Effect |
|---|---|
| `organizationId` | only events of this organization |
| `level=instance` | only events of the instance itself, without those of organizations. With `personId` it adds the events about that account in its organizations, such as ended sessions or a reset second factor. |

The lists page with `cursor` and `limit` (1 to 200, default 50); see [Conventions](conventions.md#paging).

```sh
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://wiki.example.com/api/v1/organizations/$ORG/audit-events?name=role.assigned&from=2026-10-01T00:00:00Z&limit=200"
```

## Fields

Each event has its raw columns: `id`, `scopeType`, `scopeId`, `sequence`, `name`, `actorType`, `actorId`, `targetType`, `targetId`, `fields` (details whose shape depends on the event type), `occurredAt`, `requestId`, `clientIp` and `userAgent`. It also has a readable form:

| Field | Content |
|---|---|
| `labelKey` | translation key of the action, `audit.events.` followed by the event type |
| `actor` | `type` (`account`, `system`, `anonymous`), `id`, `name` at the time of the event, `former` (anonymized), `serviceAccount` (whether the account is a service account) and `token` (name of the API token it acted with, or `null`) |
| `target` | `type`, `id` (for settings the setting key), `name` at the time of the event, `former` |
| `scope` | `type` (`instance`, `organization`, or `account` for events about one person's own account), `id` (`null` for the instance) and `name` |
| `changeKind` | `setting` or `fields`: how `changes` reads |
| `changes` | a list of `{ property, old, new }` |
| `references` | names of the accounts, organizations, groups and roles the fields refer to, by ID |
| `formerAccounts` | anonymized accounts the event refers to |
| `peopleHidden` | `true` when the event concerns a confidential space the reader is not a member of; the actor, referenced accounts and their names are then empty |

Names are stored with the event, so renaming something later does not change older entries. Events about one person's own account, such as sign-ins, password and second-factor changes, personal settings and personal API tokens, have that account as their scope.

## CSV export

`…/audit-events/export` takes the same filters and streams all matching events as CSV, newest first, without a size limit. The columns are:

1. the readable columns `time`, `actor`, `action`, `target`, `scope` and `changes`, with names in place of IDs. `action` holds the event type, such as `role.assigned`.
2. the raw columns `occurredAt`, `name`, `scopeType`, `scopeId`, `actorType`, `actorId`, `targetType`, `targetId`, `fields`, `clientIp`, `userAgent`, `requestId`, `sequence` and `id`.

Cells that start with `=`, `+`, `-`, `@`, a tab or a carriage return get a leading apostrophe, so spreadsheets do not run them as formulas. Every export is itself recorded in the audit log as `audit.exported` with its filters.

```sh
curl -s -H "Authorization: Bearer $TOKEN" -o audit.csv \
  "https://wiki.example.com/api/v1/instance/audit-events/export?level=instance&from=2026-10-01T00:00:00Z"
```
