import { type SQL, sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { Executor } from "../database/database.js";
import type { AuditTargetType } from "./catalog.js";

export interface AuditLabels {
  actor?: string;
  target?: string;
  scope?: string;
  references?: Record<string, string>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNNAMED_REFERENCES = new Set(["sessionId", "credentialId", "scopeId"]);

const TARGET_NAMES: Partial<Record<AuditTargetType, (id: string) => SQL>> = {
  account: (id) => sql`select name from accounts where id = ${id}`,
  organization: (id) => sql`select name from organizations where id = ${id}`,
  group: (id) => sql`select name from groups where id = ${id}`,
  role: (id) => sql`select name from custom_roles where id = ${id}`,
  apiToken: (id) => sql`select name from api_tokens where id = ${id}`,
  invitation: (id) => sql`select email as name from invitations where id = ${id}`,
  identityProvider: (id) => sql`select name from identity_providers where id = ${id}`,
  space: (id) => sql`select name from spaces where id = ${id}`,
};

function referencedIds(fields: unknown): string[] {
  if (fields === null || typeof fields !== "object") return [];
  const ids = new Set<string>();
  for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
    if (UNNAMED_REFERENCES.has(key) || !/(Id|Ids)$/.test(key)) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      if (typeof item === "string" && UUID.test(item)) ids.add(item.toLowerCase());
    }
  }
  return [...ids];
}

async function nameOf(executor: Executor, query: SQL): Promise<string | undefined> {
  const result = await executor.execute<{ name: string | null }>(query);
  return result.rows[0]?.name ?? undefined;
}

export async function resolveAuditLabels(
  executor: Executor,
  event: {
    actor: Principal;
    targetType: AuditTargetType;
    targetId: string | null;
    fields: unknown;
    scope: { type: "instance" | "organization"; id: string };
  },
): Promise<{ labels: AuditLabels | null; accountReferences: string[] }> {
  const labels: AuditLabels = {};
  const accountReferences: string[] = [];
  if (event.actor.type === "account") {
    const actor = await nameOf(executor, sql`select name from accounts where id = ${event.actor.id}`);
    if (actor) labels.actor = actor;
  }
  const targetQuery = TARGET_NAMES[event.targetType];
  if (targetQuery && event.targetId && UUID.test(event.targetId)) {
    const target = await nameOf(executor, targetQuery(event.targetId));
    if (target) labels.target = target;
  }
  const fieldName = (event.fields as { name?: unknown } | null)?.name;
  if (!labels.target && typeof fieldName === "string") labels.target = fieldName;
  if (event.scope.type === "organization") {
    const scope = await nameOf(executor, sql`select name from organizations where id = ${event.scope.id}`);
    if (scope) labels.scope = scope;
  }
  const ids = referencedIds(event.fields);
  if (ids.length > 0) {
    const list = sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    const rows = await executor.execute<{ id: string; name: string; kind: string }>(sql`
      select id::text as id, name, 'account' as kind from accounts where id in (${list})
      union all select id::text, name, 'organization' from organizations where id in (${list})
      union all select id::text, name, 'group' from groups where id in (${list})
      union all select id::text, name, 'role' from custom_roles where id in (${list})`);
    if (rows.rows.length > 0) {
      labels.references = Object.fromEntries(rows.rows.map((row) => [row.id, row.name]));
    }
    accountReferences.push(...rows.rows.filter((row) => row.kind === "account").map((row) => row.id));
  }
  return { labels: Object.keys(labels).length > 0 ? labels : null, accountReferences };
}
