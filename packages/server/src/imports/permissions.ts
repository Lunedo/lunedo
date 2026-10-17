import { sql } from "drizzle-orm";
import type { Executor } from "../database/database.js";

export type ImportedRole = "reader" | "commenter" | "editor" | "admin";
export type GrantStatus = "mapped" | "check" | "missing" | "notTaken";

export interface RoleDecision {
  readonly role: ImportedRole | null;
  readonly status: GrantStatus;
  readonly code: string | null;
}

const EDIT = ["EDITSPACE", "EDITBLOG"];
const BEYOND_COMMENT = [
  "EDITSPACE",
  "EDITBLOG",
  "REMOVEPAGE",
  "REMOVEBLOG",
  "CREATEATTACHMENT",
  "REMOVEATTACHMENT",
  "SETPAGEPERMISSIONS",
  "REMOVECOMMENT",
];
const EDITOR_RIGHTS = ["REMOVEPAGE", "SETPAGEPERMISSIONS"];

const OUTSIDE_SPACE_ROLES = new Set(["ACCESSANALYTICS"]);

export function grantsAccess(permissions: ReadonlySet<string>): boolean {
  return [...permissions].some((permission) => !OUTSIDE_SPACE_ROLES.has(permission));
}

export function roleFor(permissions: ReadonlySet<string>): RoleDecision {
  if (!permissions.has("VIEWSPACE")) return { role: null, status: "notTaken", code: "withoutView" };
  if (permissions.has("SETSPACEPERMISSIONS")) {
    const widened = !EDIT.some((permission) => permissions.has(permission));
    return { role: "admin", status: widened ? "check" : "mapped", code: widened ? "widened" : null };
  }
  if (EDIT.some((permission) => permissions.has(permission))) {
    const widened = EDITOR_RIGHTS.some((permission) => !permissions.has(permission));
    return { role: "editor", status: widened ? "check" : "mapped", code: widened ? "widened" : null };
  }
  const role: ImportedRole = permissions.has("COMMENT") ? "commenter" : "reader";
  const narrowed = BEYOND_COMMENT.some((permission) => permissions.has(permission));
  return { role, status: narrowed ? "check" : "mapped", code: narrowed ? "narrowed" : null };
}

export function groupKey(name: string): string {
  return name.trim().toLocaleLowerCase("en").slice(0, 255);
}

export async function ensureGroups(
  executor: Executor,
  importId: string,
  organizationId: string,
  names: readonly string[],
): Promise<Map<string, string | null>> {
  const wanted = new Map<string, string>();
  for (const name of names) {
    const key = groupKey(name);
    if (key.length > 0 && !wanted.has(key)) wanted.set(key, name.trim().slice(0, 255));
  }
  const result = new Map<string, string | null>();
  if (wanted.size === 0) return result;
  const rows = [...wanted.entries()].map(([key, name]) => ({ key, name }));
  await executor.execute(sql`
    insert into import_groups (import_id, name_key, name, group_id)
    select ${importId}, r.key, r.name,
      (select g.id from groups g where g.organization_id = ${organizationId} and lower(g.name) = r.key
        order by g.created_at limit 1)
    from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as r(key text, name text)
    on conflict (import_id, name_key) do nothing`);
  const found = await executor.execute<{ name_key: string; group_id: string | null }>(sql`
    select name_key, group_id from import_groups
    where import_id = ${importId} and name_key = any(${sql.param([...wanted.keys()])}::text[])`);
  for (const row of found.rows) result.set(row.name_key, row.group_id);
  return result;
}
