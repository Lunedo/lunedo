# Audit log

The audit log records every action that affects security, access or configuration. It is separate from the application log.

## Catalog

Every event is defined in `packages/server/src/audit/catalog.ts` with its name, the kinds of actor that can cause it, its target, a Zod schema for its fields and who may see it. Recording an event that is not in the catalog does not compile, and fields outside the schema are rejected. Events never contain passwords, tokens, codes or other secrets.

Each entry records the actor (an account, anonymous or system), the target, the time, the request ID, the client address and the user agent. Events caused by background jobs carry the request context of the request that queued the job. An event that belongs to a database change is written in the same transaction, so either both are stored or neither.

Events belong to a scope: the instance or an organization. Each scope has its own hash chain. Organization administrators with the audit log area read the events of their organization; instance administrators and security auditors read all events. A transaction that writes events of several scopes writes them in a fixed order, so that concurrent writers cannot block each other.

## Integrity

- The table `audit_events` is append-only. A database trigger rejects updates, deletes and truncation. Only the retention job may delete, through a flag that is set for its own transaction.
- Each scope forms a hash chain: every entry contains the SHA-256 hash of the previous entry of its scope, and its own hash covers all its fields. Writers lock the head of the chain until their transaction commits, so concurrent writes get consecutive sequence numbers.
- Retention removes entries older than the setting `audit.retentionDays` (default 365) once a day. The hash of the last removed entry is kept as the anchor of the chain, so the remaining entries can still be verified.

## Reading and exporting

`GET /api/v1/organizations/{id}/audit-events` lists the events of an organization; it needs `organization.audit.view`, which organization administrators and holders of the audit log area have. `GET /api/v1/instance/audit-events` lists the events of the instance and all organizations; it needs `instance.audit.view`, which instance administrators and security auditors have. Both accept the filters `from`, `to`, `actorId`, `targetType`, `targetId` and `name`, the instance endpoint also `organizationId`, and page with `cursor` and `limit`, newest first.

The same filters work on `.../audit-events/export`, which streams all matching events as CSV. The export reads the events in batches, so its size is not limited by memory. Cells that start with `=`, `+`, `-`, `@`, a tab or a carriage return get a leading apostrophe, so spreadsheets do not run them as formulas. Every export is recorded as `audit.exported` with its filters.

## Verification

```sh
docker compose exec pagehall pagehall audit verify
```

The command checks every chain and prints one line per scope. When an entry was changed, removed or inserted, it names the first broken entry and exits with status 1.

The hash chain detects changes made directly in the database. Someone who can write to the database can also rewrite a whole chain consistently; protect database access accordingly and keep backups.
