import { type SQL, sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuthorizationService } from "../authorization/service.js";
import { visibleItem } from "../spaces/visibility.js";

function visibleFolders(authorization: AuthorizationService, viewer: Principal, item: SQL, column: SQL): SQL {
  return sql`array(select ${column} from tree_items c join spaces cs on cs.id = c.space_id
    where c.id = any(${item}.path) and c.id <> ${item}.id and c.kind = 'folder'
      and ${visibleItem(authorization, viewer, sql`c`, sql`cs`)}
    order by array_position(${item}.path, c.id))`;
}

export function folderIds(authorization: AuthorizationService, viewer: Principal, item: SQL): SQL {
  return visibleFolders(authorization, viewer, item, sql`c.id`);
}

export function folderTitles(authorization: AuthorizationService, viewer: Principal, item: SQL): SQL {
  return visibleFolders(authorization, viewer, item, sql`c.title`);
}
