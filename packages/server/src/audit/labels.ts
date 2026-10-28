import { type SQL, sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { Executor } from "../database/database.js";
import type { AuditTargetType } from "./catalog.js";

export interface AuditLabels {
  actor?: string;
  actorKind?: "serviceAccount";
  actorToken?: string;
  target?: string;
  scope?: string;
  references?: Record<string, string>;
}

export type AuditLabelCache = Map<string, Promise<unknown>>;

function remembered<T>(cache: AuditLabelCache | undefined, key: string, load: () => Promise<T>): Promise<T> {
  if (!cache) return load();
  const known = cache.get(key) as Promise<T> | undefined;
  if (known) return known;
  const loading = Promise.resolve(load());
  cache.set(key, loading);
  return loading;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNNAMED_REFERENCES = new Set(["sessionId", "credentialId", "scopeId"]);

const TARGET_TABLES: Partial<Record<AuditTargetType, { table: string; column: string }>> = {
  account: { table: "accounts", column: "name" },
  organization: { table: "organizations", column: "name" },
  group: { table: "groups", column: "name" },
  role: { table: "custom_roles", column: "name" },
  apiToken: { table: "api_tokens", column: "name" },
  invitation: { table: "invitations", column: "email" },
  identityProvider: { table: "identity_providers", column: "name" },
  space: { table: "spaces", column: "name" },
  page: { table: "tree_items", column: "title" },
  template: { table: "page_templates", column: "name" },
};

function targetNames(targetType: AuditTargetType, ids: readonly string[]): SQL | null {
  const target = TARGET_TABLES[targetType];
  if (!target) return null;
  return sql`select id::text as id, ${sql.identifier(target.column)} as name from ${sql.identifier(target.table)}
    where id = any(${sql.param([...ids])}::uuid[])`;
}

const PRELOAD_BATCH = 1000;

export async function preloadAuditTargets(
  executor: Executor,
  cache: AuditLabelCache,
  targets: readonly { targetType: AuditTargetType; targetId: string | null }[],
): Promise<void> {
  const byType = new Map<AuditTargetType, Set<string>>();
  for (const { targetType, targetId } of targets) {
    if (!targetId || !UUID.test(targetId) || !TARGET_TABLES[targetType]) continue;
    if (cache.has(`target:${targetType}:${targetId}`)) continue;
    const ids = byType.get(targetType) ?? new Set<string>();
    ids.add(targetId);
    byType.set(targetType, ids);
  }
  for (const [targetType, idSet] of byType) {
    const ids = [...idSet];
    for (let start = 0; start < ids.length; start += PRELOAD_BATCH) {
      const batch = ids.slice(start, start + PRELOAD_BATCH);
      const query = targetNames(targetType, batch);
      if (!query) continue;
      const result = await executor.execute<{ id: string; name: string | null }>(query);
      const names = new Map(result.rows.map((row) => [row.id.toLowerCase(), row.name ?? undefined]));
      for (const id of batch) {
        cache.set(`target:${targetType}:${id}`, Promise.resolve(names.get(id.toLowerCase())));
      }
    }
  }
}

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
    cache?: AuditLabelCache;
  },
): Promise<{ labels: AuditLabels | null; accountReferences: string[] }> {
  const labels: AuditLabels = {};
  const accountReferences: string[] = [];
  if (event.actor.type === "account") {
    const actorId = event.actor.id;
    const result = await remembered(event.cache, `actor:${actorId}`, () =>
      executor.execute<{ name: string | null; type: string }>(
        sql`select name, type from accounts where id = ${actorId}`,
      ),
    );
    const account = result.rows[0];
    if (account?.name) labels.actor = account.name;
    if (account?.type === "service") labels.actorKind = "serviceAccount";
    if (event.actor.token) {
      const tokenId = event.actor.token.id;
      const token = await remembered(event.cache, `token:${tokenId}`, () =>
        nameOf(executor, sql`select name from api_tokens where id = ${tokenId}`),
      );
      if (token) labels.actorToken = token;
    }
  }
  const targetId = event.targetId;
  const targetQuery = targetId && UUID.test(targetId) ? targetNames(event.targetType, [targetId]) : null;
  if (targetQuery) {
    const target = await remembered(event.cache, `target:${event.targetType}:${targetId}`, () =>
      nameOf(executor, targetQuery),
    );
    if (target) labels.target = target;
  }
  const fieldName = (event.fields as { name?: unknown } | null)?.name;
  if (!labels.target && typeof fieldName === "string") labels.target = fieldName;
  if (event.scope.type === "organization") {
    const scopeId = event.scope.id;
    const scope = await remembered(event.cache, `scope:${scopeId}`, () =>
      nameOf(executor, sql`select name from organizations where id = ${scopeId}`),
    );
    if (scope) labels.scope = scope;
  }
  const ids = referencedIds(event.fields);
  if (ids.length > 0) {
    const list = sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    const rows = await remembered(event.cache, `references:${ids.join(",")}`, () =>
      executor.execute<{ id: string; name: string; kind: string }>(sql`
      select id::text as id, name, 'account' as kind from accounts where id in (${list})
      union all select id::text, name, 'organization' from organizations where id in (${list})
      union all select id::text, name, 'group' from groups where id in (${list})
      union all select id::text, name, 'role' from custom_roles where id in (${list})`),
    );
    if (rows.rows.length > 0) {
      labels.references = Object.fromEntries(rows.rows.map((row) => [row.id, row.name]));
    }
    accountReferences.push(...rows.rows.filter((row) => row.kind === "account").map((row) => row.id));
  }
  return { labels: Object.keys(labels).length > 0 ? labels : null, accountReferences };
}
