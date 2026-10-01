import { and, desc, eq, gte, lt, or, type SQL } from "drizzle-orm";
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
  occurredAt: Date;
  requestId: string | null;
  clientIp: string | null;
  userAgent: string | null;
}

export interface AuditFilter {
  scope?: AuditScope;
  from?: Date;
  to?: Date;
  actorId?: string;
  targetType?: string;
  targetId?: string;
  name?: string;
}

export interface AuditCursor {
  occurredAt: Date;
  id: string;
}

const EXPORT_BATCH = 500;

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

  async #requireRead(actor: Principal, scope: AuditScope | undefined): Promise<void> {
    if (await this.#authorization.authorize(actor, "instance.audit.view", { type: "instance" })) return;
    if (scope?.type === "organization") {
      await this.#authorization.require(actor, "organization.audit.view", {
        type: "organization",
        id: scope.id,
      });
      return;
    }
    throw new ForbiddenError(
      await this.#authorization.explain(actor, "instance.audit.view", { type: "instance" }),
    );
  }

  #where(filter: AuditFilter, cursor: AuditCursor | undefined): SQL | undefined {
    return and(
      filter.scope ? eq(auditEvents.scopeType, filter.scope.type) : undefined,
      filter.scope ? eq(auditEvents.scopeId, filter.scope.id) : undefined,
      filter.from ? gte(auditEvents.occurredAt, filter.from) : undefined,
      filter.to ? lt(auditEvents.occurredAt, filter.to) : undefined,
      filter.actorId ? eq(auditEvents.actorId, filter.actorId) : undefined,
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

  async #page(filter: AuditFilter, cursor: AuditCursor | undefined, limit: number): Promise<AuditEntry[]> {
    return this.#database
      .select(columns)
      .from(auditEvents)
      .where(this.#where(filter, cursor))
      .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
      .limit(limit);
  }

  async list(
    actor: Principal,
    filter: AuditFilter,
    options: { limit?: number; cursor?: AuditCursor } = {},
  ): Promise<{ items: AuditEntry[]; next: AuditCursor | null }> {
    await this.#requireRead(actor, filter.scope);
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 1000);
    const rows = await this.#page(filter, options.cursor, limit + 1);
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return { items, next: rows.length > limit && last ? { occurredAt: last.occurredAt, id: last.id } : null };
  }

  async export(actor: Principal, filter: AuditFilter): Promise<AsyncIterable<AuditEntry>> {
    await this.#requireRead(actor, filter.scope);
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
    const page = (cursor: AuditCursor | undefined) => this.#page(filter, cursor, EXPORT_BATCH);
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
