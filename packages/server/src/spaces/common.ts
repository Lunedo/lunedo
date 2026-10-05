import { sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import { type AuditScope, INSTANCE_AUDIT_SCOPE } from "../audit/audit-log.js";
import type { SpaceGrantRow } from "../authorization/space-access.js";
import type { Executor } from "../database/database.js";
import type { SpaceRole } from "./schema.js";
import type { SpaceGrant } from "./settings.js";

export class SpaceError extends Error {
  override name = "SpaceError";

  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const cause = (error as { cause?: unknown }).cause ?? error;
  const details = cause as { code?: string; constraint?: string };
  return details.code === "23505" && details.constraint === constraint;
}

export function auditScopeOf(space: { organizationId: string | null }): AuditScope {
  return space.organizationId ? { type: "organization", id: space.organizationId } : INSTANCE_AUDIT_SCOPE;
}

export function actorIdOf(actor: Principal): string | null {
  return actor.type === "account" ? actor.id : null;
}

function holderKey(grant: Pick<SpaceGrantRow, "principalKind" | "principalId">): string {
  return `${grant.principalKind}:${grant.principalId ?? ""}`;
}

export function mergeGrants(...lists: SpaceGrant[][]): SpaceGrant[] {
  const merged = new Map<string, SpaceGrant>();
  for (const grant of lists.flat()) merged.set(holderKey(grant), grant);
  return [...merged.values()];
}

export async function currentGrants(executor: Executor, spaceId: string): Promise<SpaceGrantRow[]> {
  const result = await executor.execute<{
    principal_kind: SpaceGrantRow["principalKind"];
    principal_id: string | null;
    role: SpaceRole;
  }>(sql`select principal_kind, principal_id, role from space_permissions where space_id = ${spaceId}`);
  return result.rows.map((row) => ({
    principalKind: row.principal_kind,
    principalId: row.principal_id,
    role: row.role,
  }));
}
