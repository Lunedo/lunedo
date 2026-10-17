import { sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Executor } from "../database/database.js";
import { visibleItem } from "../spaces/visibility.js";

export interface CopiedFrom {
  itemId: string | null;
  title: string;
}

export function copiedFrom(row: {
  copied_from_id: string | null;
  copied_from_title: string | null;
}): CopiedFrom | null {
  return row.copied_from_title === null ? null : { itemId: row.copied_from_id, title: row.copied_from_title };
}

export async function visibleSources<T extends { copiedFrom: CopiedFrom | null }>(
  executor: Executor,
  authorization: AuthorizationService,
  viewer: Principal,
  versions: T[],
): Promise<T[]> {
  const ids = [...new Set(versions.flatMap((version) => version.copiedFrom?.itemId ?? []))];
  if (ids.length === 0) return versions;
  const visible = await executor.execute<{ id: string }>(sql`
    select t.id from tree_items t join spaces s on s.id = t.space_id
    where t.id = any(${sql.param(ids)}::uuid[]) and ${visibleItem(authorization, viewer, sql`t`, sql`s`)}`);
  const allowed = new Set(visible.rows.map((row) => row.id));
  return versions.map((version) =>
    version.copiedFrom?.itemId && !allowed.has(version.copiedFrom.itemId)
      ? { ...version, copiedFrom: { ...version.copiedFrom, itemId: null } }
      : version,
  );
}
