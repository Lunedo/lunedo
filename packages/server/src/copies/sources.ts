import { sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Executor } from "../database/database.js";
import { pagePath, whiteboardPath } from "../spaces/documents.js";
import { visibleItem } from "../spaces/visibility.js";

export interface CopiedFrom {
  itemId: string | null;
  title: string | null;
  path: string | null;
}

const HIDDEN: CopiedFrom = { itemId: null, title: null, path: null };

export function copiedFrom(row: {
  copied_from_id: string | null;
  copied_from_title: string | null;
}): CopiedFrom | null {
  return row.copied_from_title === null
    ? null
    : { itemId: row.copied_from_id, title: row.copied_from_title, path: null };
}

export async function visibleSources<T extends { copiedFrom: CopiedFrom | null }>(
  executor: Executor,
  authorization: AuthorizationService,
  viewer: Principal,
  versions: T[],
): Promise<T[]> {
  const ids = [...new Set(versions.flatMap((version) => version.copiedFrom?.itemId ?? []))];
  const visible =
    ids.length === 0
      ? []
      : (
          await executor.execute<{ id: string; kind: string; title: string; key: string }>(sql`
            select t.id, t.kind, t.title, s.key from tree_items t join spaces s on s.id = t.space_id
            where t.id = any(${sql.param(ids)}::uuid[]) and ${visibleItem(authorization, viewer, sql`t`, sql`s`)}`)
        ).rows;
  const paths = new Map(
    visible.map((row) => [
      row.id,
      row.kind === "whiteboard"
        ? whiteboardPath(row.key, row.id, row.title)
        : pagePath(row.key, row.id, row.title),
    ]),
  );
  return versions.map((version) => {
    if (!version.copiedFrom) return version;
    const path = version.copiedFrom.itemId ? paths.get(version.copiedFrom.itemId) : undefined;
    return { ...version, copiedFrom: path ? { ...version.copiedFrom, path } : HIDDEN };
  });
}
