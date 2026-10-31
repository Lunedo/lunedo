# Audit log internals

How the audit log is built: the catalog, the hash chains, retention and personal data. What operators see is in [admin/audit-log.md](../admin/audit-log.md), the API in [api/audit-log.md](../api/audit-log.md).

## Catalog

Every event is defined in `packages/server/src/audit/catalog.ts` with its name, the kinds of actor that can cause it, its target, a Zod schema for its fields and who may see it. Recording an event that is not in the catalog does not compile, fields outside the schema are rejected, and an actor type the definition does not list throws. Events never contain passwords, tokens, codes or other secrets.

Each entry records the actor (an account, anonymous or system), the target, the time, the request ID, the client address and the user agent. Events caused by background jobs carry the request context of the request that queued the job. `AuditLog.record` takes the transaction of the change, so an event and its database change are stored together or not at all.

Each entry also stores the names at the time of the event in `labels`: of the acting account, of the target, of the organization and of every account, organization, group and role its fields refer to by ID. Setting changes record the key, the level and its scope, the action, the previous and the new value at that level and the previous lock state. Personal preferences of an account (the `appearance.*` and `locale.*` settings at the user level) are not audited. Updates of organizations, groups, roles, service accounts and API tokens record the previous values in `previous`.

The catalog also defines how an event reads: its action label is the translation key `audit.events.<name>`, its target is shown by name, and its change is either a setting change or a list of changed fields. Fields named `previousX` and `newX` and the `previous` object pair up into old and new values; unchanged fields of an update and technical references such as session IDs are left out. `packages/server/src/audit/presentation.ts` builds this view for the API responses and the CSV export; the interface shows what the API returns.

## Scopes and hash chains

Events belong to a scope: the instance or an organization. Each scope has its own chain in `audit_chains`:

- Every entry contains the SHA-256 hash of the previous entry of its scope. Its own hash covers the canonical JSON of all its columns, the stored names and the sealed personal data (`hashAuditEntry` in `audit-log.ts`).
- A writer inserts the chain row if needed and locks it until its transaction commits, so concurrent writes get consecutive sequence numbers.
- `AuditLog.verify` walks every chain from its anchor and reports the first entry whose sequence, previous hash or own hash does not match. `lunedo audit verify` prints the result and exits with 1 when a chain is broken.

## Append-only table

Database triggers on `audit_events` reject `UPDATE`, `DELETE` and `TRUNCATE`. Only the retention job may delete: it sets the transaction-local flag `lunedo.audit_retention` to `on`, which the trigger accepts for `DELETE`.

## Retention

The job `audit.apply-retention` runs daily at 03:41 UTC (`AUDIT_RETENTION_SCHEDULE` in `retention.ts`) and also during maintenance mode. It removes entries older than the instance setting `audit.retentionDays` (default 365, 1 to 36,500). Per chain it stores the sequence and the hash of the last removed entry as `anchorSequence` and `anchorHash`, so the remaining entries can still be verified.

## Personal data

Personal data of an account in an event is sealed with a key of its own per account (`personal-data.ts`): the account's name as actor, target or reference, its e-mail and sign-in addresses in the fields the catalog marks as `personal`, and the IP address and user agent of requests it made. The event keeps the account ID in plain form. The keys are stored in `audit_subject_keys`, wrapped with the master key like other secrets (see [encryption.md](encryption.md)). Invitations as targets get a key of their own.

The hash covers the sealed values. Anonymizing an account destroys its keys: its events remain, show "former user" with the account ID (`former` on actor and target, `formerAccounts` for references), and the hash chain still verifies.

## Confidential spaces

When an event refers to a confidential space, through its target or the fields `spaceId`, `itemId` or `pageId`, `record` empties the content fields (`name`, `title`, `fileName`, `note`, `description`) and does not store the target's name. The link between event and space is kept in `audit_confidential_events`. The reader (`reader.ts`) marks such events as `peopleHidden` for viewers who cannot see the space and removes the people from them; filters by actor or person leave them out for those viewers.

## Reading

`AuditReader` in `reader.ts` checks `organization.audit.view` or `instance.audit.view`, pages newest first with a cursor of time and ID, and unseals the personal data of the page. `ACCOUNT_SECURITY_EVENTS` and `TOKEN_SECURITY_EVENTS` define the events of an account's own security activity.
