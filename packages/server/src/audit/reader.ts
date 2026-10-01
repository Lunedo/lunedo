import { and, desc, eq, lt } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuthorizationService } from "../authorization/service.js";
import { ForbiddenError } from "../authorization/service.js";
import type { Database } from "../database/database.js";
import type { AuditScope } from "./audit-log.js";
import { auditEvents } from "./schema.js";

export interface AuditEntry {
  id: string;
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

export class AuditReader {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;

  constructor(options: { database: Database; authorization: AuthorizationService }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
  }

  async #mayRead(actor: Principal, scope: AuditScope): Promise<boolean> {
    if (await this.#authorization.authorize(actor, "instance.audit.view", { type: "instance" })) return true;
    if (scope.type === "instance") return false;
    return this.#authorization.authorize(actor, "organization.audit.view", {
      type: "organization",
      id: scope.id,
    });
  }

  async list(
    actor: Principal,
    scope: AuditScope,
    options: { limit?: number; beforeSequence?: number } = {},
  ): Promise<AuditEntry[]> {
    if (!(await this.#mayRead(actor, scope))) {
      const decision = await this.#authorization.explain(
        actor,
        scope.type === "instance" ? "instance.audit.view" : "organization.audit.view",
        scope.type === "instance" ? { type: "instance" } : { type: "organization", id: scope.id },
      );
      throw new ForbiddenError(decision);
    }
    return this.#database
      .select({
        id: auditEvents.id,
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
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.scopeType, scope.type),
          eq(auditEvents.scopeId, scope.id),
          options.beforeSequence === undefined ? undefined : lt(auditEvents.sequence, options.beforeSequence),
        ),
      )
      .orderBy(desc(auditEvents.sequence))
      .limit(Math.min(options.limit ?? 100, 1000));
  }
}
