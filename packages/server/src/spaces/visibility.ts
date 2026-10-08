import { type SQL, sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Executor } from "../database/database.js";

export function notTrashed(item: SQL): SQL {
  return sql`${item}.trash_entry_id is null`;
}

export function inTree(item: SQL): SQL {
  return sql`(${item}.trash_entry_id is null and ${item}.archived_root_id is null)`;
}

function published(item: SQL): SQL {
  return sql`(${item}.kind not in ('page', 'blogPost') or ${item}.mode = 'live' or ${item}.published_version_id is not null)`;
}

export function publishedFor(
  authorization: AuthorizationService,
  viewer: Principal,
  item: SQL,
  space: SQL,
): SQL {
  return sql`(${item}.reader_visible or ${authorization.spaceFilter(viewer, space, "editor")})`;
}

export async function refreshReaderVisibility(executor: Executor, itemIds: string[]): Promise<string[]> {
  const revealed: string[] = [];
  for (const itemId of new Set(itemIds)) {
    const result = await executor.execute<{ id: string; visible: boolean }>(sql`
      with recursive walk(id, visible) as (
        select t.id, coalesce(p.reader_visible, true) and ${published(sql`t`)}
        from tree_items t left join tree_items p on p.id = coalesce(t.parent_id, t.restore_parent_id)
        where t.id = ${itemId}
        union
        select c.id, w.visible and ${published(sql`c`)}
        from tree_items c join walk w
          on c.parent_id = w.id or (c.parent_id is null and c.restore_parent_id = w.id)
      )
      update tree_items t set reader_visible = w.visible from walk w
      where t.id = w.id and t.reader_visible <> w.visible
      returning t.id, t.reader_visible as visible`);
    for (const row of result.rows) if (row.visible) revealed.push(row.id);
  }
  return revealed;
}

export function visibleItem(
  authorization: AuthorizationService,
  viewer: Principal,
  item: SQL,
  space: SQL,
): SQL {
  return sql`(${notTrashed(item)} and ${authorization.spaceFilter(viewer, space)}
    and ${publishedFor(authorization, viewer, item, space)})`;
}
