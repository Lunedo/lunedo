import { and, desc, eq, gte, inArray, lt, not, or, type SQL, sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuthorizationService } from "../authorization/service.js";
import { ForbiddenError } from "../authorization/service.js";
import type { Database } from "../database/database.js";
import { type AuditLog, type AuditScope, INSTANCE_AUDIT_SCOPE } from "./audit-log.js";
import { auditEvents } from "./schema.js";

export interface AuditEntry {
  id: string;
  scopeType: "instance" | "organization";
  scopeId: string;
  sequence: number;
  name: string;
  actorType: string;
  actorId: string | null;
  targetType: string;
  targetId: string | null;
  fields: unknown;
  labels: unknown;
  occurredAt: Date;
  requestId: string | null;
  clientIp: string | null;
  userAgent: string | null;
  formerSubjects: string[];
  peopleHidden: boolean;
}

export interface AuditFilter {
  scope?: AuditScope;
  from?: Date;
  to?: Date;
  actorId?: string;
  personId?: string;
  targetType?: string;
  targetId?: string;
  name?: string;
}

export interface AuditCursor {
  occurredAt: Date;
  id: string;
}

const EXPORT_BATCH = 500;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEPT_REFERENCES = new Set([
  "spaceId",
  "itemId",
  "pageId",
  "parentId",
  "attachmentId",
  "commentId",
  "discardedDraftId",
  "importId",
  "organizationId",
]);

type StoredEntry = Omit<AuditEntry, "formerSubjects" | "peopleHidden"> & { sealed: unknown };
type Row = StoredEntry & { hidden: boolean };

function namesSomeone(value: unknown): boolean {
  if (typeof value === "string") return UUID.test(value);
  return Array.isArray(value) && value.some(namesSomeone);
}

function withoutPeople(row: StoredEntry): StoredEntry {
  const fields =
    row.fields !== null && typeof row.fields === "object" && !Array.isArray(row.fields)
      ? Object.fromEntries(
          Object.entries(row.fields as Record<string, unknown>).filter(
            ([key, value]) => KEPT_REFERENCES.has(key) || !namesSomeone(value),
          ),
        )
      : row.fields;
  const labels = (row.labels ?? {}) as { scope?: unknown; target?: unknown };
  const kept = {
    ...(labels.scope !== undefined ? { scope: labels.scope } : {}),
    ...(labels.target !== undefined ? { target: labels.target } : {}),
  };
  return {
    ...row,
    actorId: null,
    fields,
    labels: Object.keys(kept).length > 0 ? kept : null,
    sealed: null,
    requestId: null,
    clientIp: null,
    userAgent: null,
  };
}

export const ACCOUNT_SECURITY_EVENTS = [
  "auth.signedIn",
  "auth.signInFailed",
  "auth.lockedOut",
  "auth.signedOut",
  "auth.sessionEnded",
  "account.passwordChanged",
  "account.passwordReset",
  "account.emailChanged",
  "account.secondFactorReset",
  "twoFactor.totpAdded",
  "twoFactor.totpRemoved",
  "twoFactor.passkeyAdded",
  "twoFactor.passkeyRemoved",
  "twoFactor.recoveryCodesGenerated",
  "twoFactor.recoveryCodeUsed",
] as const;

export const TOKEN_SECURITY_EVENTS = ["apiToken.created", "apiToken.revoked", "apiToken.expired"] as const;

const columns = {
  id: auditEvents.id,
  scopeType: auditEvents.scopeType,
  scopeId: auditEvents.scopeId,
  sequence: auditEvents.sequence,
  name: auditEvents.name,
  actorType: auditEvents.actorType,
  actorId: auditEvents.actorId,
  targetType: auditEvents.targetType,
  targetId: auditEvents.targetId,
  fields: auditEvents.fields,
  labels: auditEvents.labels,
  sealed: auditEvents.sealed,
  occurredAt: auditEvents.occurredAt,
  requestId: auditEvents.requestId,
  clientIp: auditEvents.clientIp,
  userAgent: auditEvents.userAgent,
};

export class AuditReader {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #audit: AuditLog | undefined;

  constructor(options: { database: Database; authorization: AuthorizationService; audit?: AuditLog }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#audit = options.audit;
  }

  async #requireRead(actor: Principal, scope: AuditScope | undefined): Promise<Principal | null> {
    if (await this.#authorization.authorize(actor, "instance.audit.view", { type: "instance" })) return null;
    if (scope?.type === "organization") {
      await this.#authorization.require(actor, "organization.audit.view", {
        type: "organization",
        id: scope.id,
      });
      return actor;
    }
    throw new ForbiddenError(
      await this.#authorization.explain(actor, "instance.audit.view", { type: "instance" }),
    );
  }

  #hidden(viewer: Principal | null): SQL<boolean> {
    if (!viewer) return sql<boolean>`false`;
    return sql<boolean>`exists (select 1 from audit_confidential_events ace
      where ace.event_id = ${auditEvents.id} and not exists (select 1 from spaces s
        where s.id = ace.space_id and ${this.#authorization.spaceFilter(viewer, sql`s`)}))`;
  }

  #where(filter: AuditFilter, cursor: AuditCursor | undefined, viewer: Principal | null): SQL | undefined {
    const hidden = this.#hidden(viewer);
    return and(
      filter.scope ? eq(auditEvents.scopeType, filter.scope.type) : undefined,
      filter.scope ? eq(auditEvents.scopeId, filter.scope.id) : undefined,
      filter.from ? gte(auditEvents.occurredAt, filter.from) : undefined,
      filter.to ? lt(auditEvents.occurredAt, filter.to) : undefined,
      filter.actorId ? and(eq(auditEvents.actorId, filter.actorId), not(hidden)) : undefined,
      filter.personId
        ? and(
            or(
              eq(auditEvents.actorId, filter.personId),
              and(eq(auditEvents.targetType, "account"), eq(auditEvents.targetId, filter.personId)),
              sql`${auditEvents.fields} ->> 'accountId' = ${filter.personId}`,
              sql`${auditEvents.fields} ->> 'principalId' = ${filter.personId}`,
            ),
            not(hidden),
          )
        : undefined,
      filter.targetType ? eq(auditEvents.targetType, filter.targetType) : undefined,
      filter.targetId ? eq(auditEvents.targetId, filter.targetId) : undefined,
      filter.name ? eq(auditEvents.name, filter.name) : undefined,
      cursor
        ? or(
            lt(auditEvents.occurredAt, cursor.occurredAt),
            and(eq(auditEvents.occurredAt, cursor.occurredAt), lt(auditEvents.id, cursor.id)),
          )
        : undefined,
    );
  }

  async #readable(rows: Row[]): Promise<AuditEntry[]> {
    const prepared = rows.map(({ hidden, ...row }) => ({
      ...(hidden ? withoutPeople(row) : row),
      formerSubjects: [] as string[],
      peopleHidden: hidden,
    }));
    const sealer = this.#audit?.sealer;
    const unsealed = sealer
      ? await sealer.unseal(this.#database, prepared)
      : prepared.map((row) => ({
          ...row,
          formerSubjects: Object.keys((row.sealed ?? {}) as Record<string, string>).sort(),
        }));
    return unsealed.map(({ sealed: _sealed, ...entry }) => entry);
  }

  async #page(
    filter: AuditFilter,
    cursor: AuditCursor | undefined,
    limit: number,
    viewer: Principal | null,
  ): Promise<AuditEntry[]> {
    const rows = await this.#database
      .select({ ...columns, hidden: this.#hidden(viewer) })
      .from(auditEvents)
      .where(this.#where(filter, cursor, viewer))
      .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
      .limit(limit);
    return this.#readable(rows);
  }

  async list(
    actor: Principal,
    filter: AuditFilter,
    options: { limit?: number; cursor?: AuditCursor } = {},
  ): Promise<{ items: AuditEntry[]; next: AuditCursor | null }> {
    const viewer = await this.#requireRead(actor, filter.scope);
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 1000);
    const rows = await this.#page(filter, options.cursor, limit + 1, viewer);
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return { items, next: rows.length > limit && last ? { occurredAt: last.occurredAt, id: last.id } : null };
  }

  async securityActivity(
    actor: Principal,
    accountId: string,
    options: { limit?: number; cursor?: AuditCursor } = {},
  ): Promise<{ items: AuditEntry[]; next: AuditCursor | null }> {
    await this.#authorization.require(actor, "account.activity.view", { type: "account", id: accountId });
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const cursor = options.cursor;
    const rows = await this.#database
      .select(columns)
      .from(auditEvents)
      .where(
        and(
          or(
            and(
              eq(auditEvents.targetType, "account"),
              eq(auditEvents.targetId, accountId),
              inArray(auditEvents.name, [...ACCOUNT_SECURITY_EVENTS]),
            ),
            and(
              inArray(auditEvents.name, [...TOKEN_SECURITY_EVENTS]),
              sql`${auditEvents.fields}->>'accountId' = ${accountId}`,
            ),
          ),
          cursor
            ? or(
                lt(auditEvents.occurredAt, cursor.occurredAt),
                and(eq(auditEvents.occurredAt, cursor.occurredAt), lt(auditEvents.id, cursor.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
      .limit(limit + 1);
    const items = await this.#readable(rows.slice(0, limit).map((row) => ({ ...row, hidden: false })));
    const last = items.at(-1);
    return { items, next: rows.length > limit && last ? { occurredAt: last.occurredAt, id: last.id } : null };
  }

  async export(actor: Principal, filter: AuditFilter): Promise<AsyncIterable<AuditEntry>> {
    const viewer = await this.#requireRead(actor, filter.scope);
    if (actor.type === "account" && this.#audit) {
      const scope = filter.scope ?? INSTANCE_AUDIT_SCOPE;
      await this.#audit.recordAlone({
        name: "audit.exported",
        actor,
        targetId: null,
        fields: {
          scopeType: filter.scope?.type ?? "all",
          scopeId: scope.id,
          from: filter.from?.toISOString() ?? null,
          to: filter.to?.toISOString() ?? null,
          actorId: filter.actorId ?? null,
          targetType: filter.targetType ?? null,
          targetId: filter.targetId ?? null,
          name: filter.name ?? null,
        },
        scope,
      });
    }
    const page = (cursor: AuditCursor | undefined) => this.#page(filter, cursor, EXPORT_BATCH, viewer);
    return {
      async *[Symbol.asyncIterator]() {
        let cursor: AuditCursor | undefined;
        while (true) {
          const rows = await page(cursor);
          yield* rows;
          const last = rows.at(-1);
          if (rows.length < EXPORT_BATCH || !last) return;
          cursor = { occurredAt: last.occurredAt, id: last.id };
        }
      },
    };
  }
}
